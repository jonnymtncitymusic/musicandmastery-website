#!/usr/bin/env node
/**
 * Proves the review wall is honest and the landing pages carry the Hormozi teardown edits.
 *
 *  1. Every quote in js/reviews.js is a Google review from data/google-reviews-*.json, word for
 *     word: the whole text, or its leading whole sentences (cut at . ! ? before a space, never
 *     at "Co." or "Mr."). No splice, no ellipsis, at most 50, each reviewer once.
 *  2. Every page loads js/reviews.js and css/lp-proof.css at ?v=<their current hash>. /js/ is
 *     served immutable for a year, so a stale token strands returning visitors on old reviews.
 *  3. Every landing page has the four edits: button + rating line ABOVE the hero video, the
 *     wall with the same-company caveat, who-it-is-for, and the P.S. The review count and the
 *     rating printed on the page match the data file.
 *
 *   node scripts/check-reviews.mjs        (part of npm test)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 10);
const fails = [];
const fail = m => fails.push(m);

const dataFile = fs.readdirSync(path.join(ROOT, 'data')).filter(f => /^google-reviews-.*\.json$/.test(f)).sort().pop();
const data = JSON.parse(read(`data/${dataFile}`));
const byName = new Map(data.reviews.map(r => [r.name, r.text]));

// 1. quotes
const js = read('js/reviews.js');
const gen = js.slice(js.indexOf('// BEGIN GENERATED'), js.indexOf('// END GENERATED'));
const rows = gen.split('\n').filter(l => l.trim().startsWith('{')).map(l => JSON.parse(l.trim().replace(/,$/, '')));
if (!rows.length) fail('js/reviews.js: no generated reviews found');
if (rows.length > 50) fail(`js/reviews.js: ${rows.length} reviews, the wall holds at most 50`);
const seen = new Set();
for (const r of rows) {
  if (seen.has(r.n)) fail(`${r.n}: quoted twice`);
  seen.add(r.n);
  const src = byName.get(r.n);
  if (src == null) { fail(`${r.n}: not in ${dataFile}`); continue; }
  if (!r.q) { fail(`${r.n}: empty quote`); continue; }
  if (/\.\.\.|…/.test(r.q) && !src.includes(r.q)) fail(`${r.n}: ellipsis`);
  if (r.q === src) continue;
  const rest = src.slice(r.q.length);
  if (!src.startsWith(r.q)) fail(`${r.n}: quote is not the review's own words from its first word`);
  else if (!/[.!?]$/.test(r.q) || /\b(Co|Mr|Mrs|Ms|Dr)\.$/.test(r.q) || !/^\s/.test(rest)) fail(`${r.n}: excerpt does not end at a sentence end`);
  if (!['young', 'teen', 'adult', ''].includes(r.a)) fail(`${r.n}: unknown age tag ${r.a}`);
}

// 2 + 3. pages
const LANDING = fs.readdirSync(ROOT).filter(f => /^(beginner-|in-home-).*\.html$|-lessons-(orange-county|los-angeles)\.html$/.test(f));
if (LANDING.length !== 34) fail(`expected 34 landing pages, found ${LANDING.length}`);
const CAVEAT = 'Music and Mastery and Mountain City Music Co. are the same company. Mountain City Music Co. is our original name.';
const tokens = { 'js/reviews.js': hash('js/reviews.js'), 'css/lp-proof.css': hash('css/lp-proof.css') };
for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))) {
  const t = read(f);
  for (const [asset, v] of Object.entries(tokens)) {
    for (const m of t.matchAll(new RegExp(`/${asset.replace('.', '\\.')}\\?v=([0-9a-f]+)`, 'g'))) {
      if (m[1] !== v) fail(`${f}: ${asset}?v=${m[1]} is stale, file is ${v} (run python3 scripts/build-reviews.py)`);
    }
  }
}
for (const f of LANDING) {
  const t = read(f);
  const need = { 'js/reviews.js': '/js/reviews.js?v=', 'css/lp-proof.css': '/css/lp-proof.css?v=',
    'rating line': 'class="hero-rating"', 'review wall': 'data-review-wall', 'who it is for': '<section class="qualify">',
    'P.S.': '<section class="ps-section">' };
  for (const [what, s] of Object.entries(need)) if (!t.includes(s)) fail(`${f}: missing ${what}`);
  const cta = t.indexOf('class="hero-cta-wrap'), vsl = t.indexOf('<div class="hero-vsl');
  if (cta < 0 || vsl < 0 || cta > vsl) fail(`${f}: the hero button must come before the video (first phone screen)`);
  const rating = t.indexOf('class="hero-rating"');
  if (rating < cta || rating > vsl) fail(`${f}: the rating line must sit with the button, above the video`);
  const wall = t.slice(t.indexOf('<section class="rv-section"'), t.indexOf('data-review-wall'));
  if (!wall.includes(CAVEAT)) fail(`${f}: review wall lost the same-company caveat`);
  for (const m of t.matchAll(/(\d+) Google reviews/g)) if (+m[1] !== data.count) fail(`${f}: says ${m[1]} Google reviews, data says ${data.count}`);
  for (const m of t.matchAll(/<strong>(\d\.\d)<\/strong> from/g)) if (+m[1] !== data.average) fail(`${f}: says ${m[1]}, data says ${data.average}`);
  if ((t.match(/class="hero-vsl-btn"/g) || []).length !== 1) fail(`${f}: hero video must have exactly one unmute button`);
}
// The card label is the per-card caveat.
if (!js.includes("'Google review of Mountain City Music Co.'")) fail('js/reviews.js: cards lost the "Google review of Mountain City Music Co." label');

if (fails.length) { console.error(`review check FAILED (${fails.length}):\n  ` + fails.join('\n  ')); process.exit(1); }
console.log(`review check: ${rows.length} quotes verbatim against ${dataFile}, ${LANDING.length} landing pages carry all four edits`);
