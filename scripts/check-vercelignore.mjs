#!/usr/bin/env node
/**
 * Fails when a file the site REFERENCES is listed in .vercelignore.
 *
 * .vercelignore keeps source masters and unused exports off the CDN. It was generated on
 * 2026-08-24 from a scan of what the pages used THAT DAY, and nothing checked it again.
 * On 2026-09-02 the piano landing pages started using brand_assets/piano-lesson-overhead.webp,
 * which was still on the list, so Vercel never shipped it. Every browser that understands
 * WebP (nearly all of them) asked for that file first, got a 404, and showed a broken hero
 * image at the top of both piano ad landing pages and the homepage for a month, while those
 * pages took most of the paid clicks. Three more referenced files were blocked the same way.
 *
 * A git-tracked file is not a deployed file. This check is the bridge between the two: run
 * by `npm test` and by the pre-commit hook.
 *
 *   node scripts/check-vercelignore.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE = path.join(ROOT, '.vercelignore');
if (!fs.existsSync(IGNORE)) { console.log('vercelignore check: no .vercelignore'); process.exit(0); }

// .vercelignore uses gitignore syntax. The entries here are literal paths, but a glob is
// translated rather than silently compared as text, so a future `brand_assets/*.webp` line
// is still caught.
const toRegex = pat => {
  const anchored = pat.startsWith('/');
  const p = pat.replace(/^\//, '').replace(/\/$/, '');
  const body = p.split('**').map(seg =>
    seg.split('*').map(s => s.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('[^/]*')
  ).join('.*');
  // A directory entry (`scripts/`) covers everything under it.
  return new RegExp(`${anchored ? '^' : '(^|/)'}${body}(/.*)?$`);
};
const rules = fs.readFileSync(IGNORE, 'utf8').split('\n')
  .map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('!'))
  .map(l => ({ line: l, re: toRegex(l) }));

// Every reference to a local asset from a shipped page, stylesheet or script. src, href,
// srcset (every candidate, not just the first), CSS url(), and quoted strings in JS.
const files = fs.readdirSync(ROOT).filter(f => /\.(html|css)$/.test(f))
  .concat(fs.existsSync(path.join(ROOT, 'js'))
    ? fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => `js/${f}`) : []);
const refs = new Map();   // asset path -> first file that references it
const ASSET = /(?:^|[\s"'(,=])\/?((?:brand_assets|js|css|fonts|images?)\/[^"'()\s,>]+)/g;
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of text.matchAll(ASSET)) {
    let ref = m[1].split(/[?#]/)[0];
    try { ref = decodeURIComponent(ref); } catch { /* leave as written */ }
    if (!refs.has(ref)) refs.set(ref, f);
  }
}

const blocked = [];
for (const [ref, from] of refs) {
  const rule = rules.find(r => r.re.test(ref));
  if (rule) blocked.push({ ref, from, rule: rule.line });
}

if (blocked.length) {
  console.error('vercelignore check: these files are REFERENCED by the site but excluded from deploy:');
  for (const b of blocked) console.error(`  ${b.ref}  (used by ${b.from}; blocked by .vercelignore "${b.rule}")`);
  console.error('Each one is a 404 on the live site. Remove the line from .vercelignore, or stop referencing the file.');
  process.exit(1);
}
console.log(`vercelignore check: clean (${refs.size} referenced assets, ${rules.length} ignore rules)`);
