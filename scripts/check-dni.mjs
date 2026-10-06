#!/usr/bin/env node
// Fails if a Google Ads landing page cannot measure a phone call.
//
// Every page an ad points at must carry dynamic number insertion (DNI) for its
// region's WEBSITE_CALL conversion action, and its tap handler must yield when the
// number has been swapped. Without DNI a caller from that ad can only ever register
// as a tap, and the weekly report's kill gates (mcmc-ads-report) count a form submit
// or a call past 60 seconds as a genuine lead, never a tap. So a page without DNI
// makes its ad group look dead even when the phone is ringing. That is exactly what
// guitar-lessons-orange-county.html was doing from 2026-09-08 to 2026-10-05.
//
// When a new ad group points at a new page, add the page here in the same commit.
//
// Run directly:   node scripts/check-dni.mjs [file ...]
// With file args it checks those files against the label of the page they are named
// after; used by the self-test to prove a page without DNI fails.

import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const OC = 'AW-11066542604/NfzuCLjBoOscEIyU-Jwp'; // 7741120696 Website call - M&M Orange County
const LA = 'AW-11066542604/uT2JCI6_qvEcEIyU-Jwp'; // 7753867150 Website call - M&M Los Angeles

export const AD_LANDING_PAGES = {
  'piano-lessons-orange-county.html': OC,
  'guitar-lessons-orange-county.html': OC,
  'piano-lessons-los-angeles.html': LA,
  'guitar-lessons-los-angeles.html': LA,
};

const PAGE_NUMBER = '7605732120';

function nationalDigits(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
}

export function checkPage(name, html, label) {
  const errors = [];
  const cfg = new RegExp(
    `gtag\\('config',\\s*'${label.replace(/[/]/g, '\\/')}',\\s*\\{\\s*'phone_conversion_number':\\s*'([^']+)'`,
  );
  const m = html.match(cfg);
  if (!m) {
    errors.push(`no DNI config for ${label}`);
  } else if (nationalDigits(m[1]) !== PAGE_NUMBER) {
    errors.push(`phone_conversion_number ${m[1]} is not the number the page shows`);
  }
  // Google swaps only a number that matches phone_conversion_number, so every tel:
  // link must point at it or that link is never measured.
  const tels = [...html.matchAll(/href="tel:([^"]+)"/g)].map((t) => nationalDigits(t[1]));
  if (tels.length === 0) errors.push('no tel: link to measure');
  for (const t of tels) if (t !== PAGE_NUMBER) errors.push(`tel:${t} is not ${PAGE_NUMBER}`);
  // The tap must yield on a swapped href, or one caller counts twice.
  if (html.includes("'phone_call_click'") && !/if \(callIsBeingMeasured\(link\)\) return;/.test(html)) {
    errors.push('phone_call_click handler does not yield to DNI (callIsBeingMeasured)');
  }
  return errors.map((e) => `${name}: ${e}`);
}

const args = process.argv.slice(2);
const targets = args.length
  ? args.map((f) => {
      const label = AD_LANDING_PAGES[basename(f)];
      if (!label) { console.error(`${f}: not a known ad landing page`); process.exit(2); }
      return [f, label];
    })
  : Object.entries(AD_LANDING_PAGES).map(([f, l]) => [join(root, f), l]);

let failed = [];
for (const [file, label] of targets) {
  failed = failed.concat(checkPage(basename(file), readFileSync(file, 'utf8'), label));
}
if (failed.length) {
  console.error('DNI check FAILED:\n  ' + failed.join('\n  '));
  process.exit(1);
}
console.log(`DNI check: ${targets.length} ad landing page(s) measure calls.`);
