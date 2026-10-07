#!/usr/bin/env node
/**
 * Proves the review wall is honest and the landing pages carry the Hormozi teardown edits.
 *
 *  1. Every quote in js/reviews.js is a Google review from data/google-reviews-*.json, word for
 *     word: the whole text, or its leading whole sentences (cut at . ! ? before a space, never
 *     at "Co." or "Mr."). No splice, no ellipsis, at most 50, each reviewer once.
 *  2. Every page loads js/reviews.js, js/hero-vsl.js and css/lp-proof.css at ?v=<current hash>. /js/ is
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
const tokens = { 'js/reviews.js': hash('js/reviews.js'), 'css/lp-proof.css': hash('css/lp-proof.css'), 'js/hero-vsl.js': hash('js/hero-vsl.js'), 'js/headline-test.js': hash('js/headline-test.js') };
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
// 4. Headline test (Hormozi edit #7): the paid pages each run one, picked before paint, and the
//    thank-you page credits conversions to it. A test id ends in its start date so a new
//    challenger never mixes its numbers with the last one.
const PAID = ['piano-lessons-orange-county.html', 'piano-lessons-los-angeles.html',
  'guitar-lessons-los-angeles.html', 'guitar-lessons-orange-county.html'];
const testIds = new Set();
for (const f of PAID) {
  const t = read(f);
  const h1 = t.match(/<h1[^>]*data-hl-test="([a-z0-9-]+-\d{4}-\d{2}-\d{2})"[^>]*data-hl-b="([^"]+)"[^>]*>[\s\S]*?<\/h1>\s*(?:<!--[\s\S]*?-->\s*)?<script>/);
  if (!h1) { fail(`${f}: headline test missing, or the inline picker is not right after the <h1>`); continue; }
  if (testIds.has(h1[1])) fail(`${f}: test id ${h1[1]} is used on two pages`);
  testIds.add(h1[1]);
  if (/\u2014|&mdash;/.test(h1[2])) fail(`${f}: challenger headline has an em dash`);
  if (!t.includes('/js/headline-test.js?v=')) fail(`${f}: does not load js/headline-test.js`);
}
if (!read('thank-you.html').includes('/js/headline-test.js?v=')) fail('thank-you.html: does not load js/headline-test.js, so no booking is ever credited to a headline');

// 5. FAQ structured data mirrors the visible FAQ, question and answer, on every landing page.
//    website-copy.md: a visible fix that leaves the FAQPage JSON-LD behind has bitten twice, and
//    the 2026-10-07 grade-4 rewrite changed every FAQ answer on these pages.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const plain = s => s.replace(/<[^>]+>/g, '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ').trim();
for (const f of LANDING) {
  const t = read(f);
  let pairs = [...t.matchAll(/<h4 class="local-faq-q">([\s\S]*?)<\/h4>\s*<p class="local-faq-a">([\s\S]*?)<\/p>/g)];
  if (!pairs.length) pairs = [...t.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>\s*<p[^>]*>([\s\S]*?)<\/p>/g)];
  const ld = [...t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => JSON.parse(m[1])).find(d => d['@type'] === 'FAQPage');
  if (!ld) { if (pairs.length) fail(`${f}: visible FAQ but no FAQPage JSON-LD`); continue; }
  const want = pairs.map(m => [plain(m[1]), plain(m[2])]);
  const got = ld.mainEntity.map(e => [e.name, e.acceptedAnswer.text]);
  if (JSON.stringify(want) !== JSON.stringify(got)) fail(`${f}: FAQPage JSON-LD does not match the visible FAQ (search results would show different words)`);
}

// The card label is the per-card caveat.
if (!js.includes("'Google review of Mountain City Music Co.'")) fail('js/reviews.js: cards lost the "Google review of Mountain City Music Co." label');

if (fails.length) { console.error(`review check FAILED (${fails.length}):\n  ` + fails.join('\n  ')); process.exit(1); }
console.log(`review check: ${rows.length} quotes verbatim against ${dataFile}, ${LANDING.length} landing pages carry all four edits`);
