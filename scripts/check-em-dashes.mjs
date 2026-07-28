#!/usr/bin/env node
// Fails if an em dash (U+2014) appears in customer-facing copy.
//
// Em dashes read as a signal that AI wrote the text, so they are banned from
// anything a prospect reads. Two kinds of file carry that copy:
//
//   *.html  — the page text. <style> and <script> blocks are skipped, because
//             CSS and JS comments ship to the browser but no visitor reads them.
//   js/*.js — the widget. Its comments are internal and exempt, but its STRING
//             LITERALS are rendered copy: the booking form, the slot list, and
//             the confirmation screen are all built from template literals in
//             here. Scanning only HTML missed five visible em dashes and one
//             retired-offer promise on the M&M confirmation screen (2026-07-28).
//
// Comments are stripped by a small scanner rather than a regex so that a "//"
// inside a string (every https:// URL) does not silently blank the rest of a
// line and hide a real hit behind it.
//
// Run directly:            node scripts/check-em-dashes.mjs
// Installed as a hook:     .git/hooks/pre-commit  (see scripts/install-hooks.sh)
//
// If a hit is ever legitimate, fix the copy. Do not add an exception here.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EM = '—';

// Blank a region while keeping every newline, so reported line numbers still
// point at the real line in the file.
const blank = (s) => s.replace(/[^\n]/g, ' ');

// HTML: drop the regions a visitor never reads.
function visibleHtml(html) {
  return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, blank);
}

// JS: drop comments, keep strings. Tracks quote state so "//" and "/*" inside a
// string literal are treated as text, not as the start of a comment.
function visibleJs(src) {
  let out = '';
  let i = 0;
  let quote = null; // "'", '"' or '`' while inside a string
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop; continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop; continue;
    }
    out += c; i++;
  }
  return out;
}

const targets = [];
for (const f of readdirSync(root).filter((f) => f.endsWith('.html')).sort()) {
  targets.push({ label: f, path: join(root, f), strip: visibleHtml });
}
const jsDir = join(root, 'js');
if (existsSync(jsDir)) {
  for (const f of readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort()) {
    targets.push({ label: `js/${f}`, path: join(jsDir, f), strip: visibleJs });
  }
}

let failures = 0;
for (const { label, path, strip } of targets) {
  strip(readFileSync(path, 'utf8')).split('\n').forEach((line, i) => {
    if (!line.includes(EM)) return;
    failures++;
    const col = line.indexOf(EM);
    console.error(
      `${label}:${i + 1}:${col + 1}  em dash in customer-facing copy\n` +
      `    ${line.slice(Math.max(0, col - 60), col + 60).trim()}`
    );
  });
}

if (failures) {
  console.error(
    `\n${failures} em dash${failures === 1 ? '' : 'es'} found in customer-facing copy.\n` +
    `Replace with a comma, a colon before a list, or a period before an independent clause.`
  );
  process.exit(1);
}
console.log(`em dash check: clean (${targets.length} files)`);
