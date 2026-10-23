#!/usr/bin/env node
// Every paid keyword's landing page must say what the keyword asks for (data/keyword-map.json).
//
// Quality Score scores the landing page's relevance to the keyword. On 2026-10-22 the OC piano page
// was BELOW_AVERAGE for "piano lessons near me" and never once said "near you"; nothing checked it.
// This reads each page's VISIBLE body text (no <head>, no <footer>, no scripts, styles, comments or
// tags) and fails when a word a keyword needs is missing, or when a keyword lands on a page that does
// not exist. The footer lists every city on every page and the <title> is not on-page copy, so
// counting either let "piano lessons tustin" pass on the Pasadena page (code review 2026-10-23).
// website-advisor's wa_keywords.visible_text is a line-for-line port: change both or neither.
//
//   node scripts/check-keyword-map.mjs          check the files in this repo
//   node scripts/check-keyword-map.mjs --json   the same, as JSON (for the weekly reports)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, ' ')
    .replace(/<footer[\s>][\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function checkEntry(entry, html) {
  if (html == null) return { ...entry, ok: false, missing: [], error: `page ${entry.page} does not exist` };
  const text = visibleText(html);
  const missing = entry.must_contain.filter((w) => !text.includes(w.toLowerCase()));
  return { ...entry, ok: missing.length === 0, missing };
}

function main() {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'keyword-map.json'), 'utf8'));
  const cache = new Map();
  const read = (f) => {
    if (!cache.has(f)) cache.set(f, fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : null);
    return cache.get(f);
  };
  const results = map.keywords.map((e) => checkEntry(e, read(e.page)));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 1));
    if (results.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) {
    console.error(`keyword map: "${r.keyword}" -> ${r.page}: ${r.error || 'page never says ' + r.missing.map((m) => `"${m}"`).join(', ')}`);
  }
  if (bad.length) process.exit(1);
  console.log(`keyword map: ${results.length} paid keywords, every landing page says what its keyword asks for`);
}

const invoked = (() => { try { return fs.realpathSync(process.argv[1]); } catch { return null; } })();
if (invoked && invoked === fs.realpathSync(fileURLToPath(import.meta.url))) main();
