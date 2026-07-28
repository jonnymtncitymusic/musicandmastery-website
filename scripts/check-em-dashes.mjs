#!/usr/bin/env node
// Fails if an em dash (U+2014) appears in customer-facing copy.
//
// Em dashes read as a signal that AI wrote the text, so they are banned from
// anything a prospect reads. This checks the rendered copy only: <style> and
// <script> blocks are skipped, because CSS and JS comments ship to the browser
// but no visitor reads them, and that was the agreed scope on 2026-07-28.
//
// Run directly:            node scripts/check-em-dashes.mjs
// Installed as a hook:     .git/hooks/pre-commit  (see scripts/install-hooks.sh)
//
// If a hit is ever legitimate, fix the copy. Do not add an exception here.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EM = '—';

// Strip the regions a visitor never reads, keeping byte offsets stable so the
// reported line numbers still point at the real line in the file.
function visibleOnly(html) {
  return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, (block) =>
    block.replace(/[^\n]/g, ' ')
  );
}

let failures = 0;
for (const file of readdirSync(root).filter((f) => f.endsWith('.html')).sort()) {
  const raw = readFileSync(join(root, file), 'utf8');
  visibleOnly(raw).split('\n').forEach((line, i) => {
    if (!line.includes(EM)) return;
    failures++;
    const col = line.indexOf(EM);
    console.error(
      `${file}:${i + 1}:${col + 1}  em dash in customer-facing copy\n` +
      `    ${line.trim().slice(Math.max(0, col - 60), col + 60)}`
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
console.log('em dash check: clean');
