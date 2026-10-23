#!/usr/bin/env node
// Builds the city landing pages (piano-lessons-irvine.html and friends) from their region page.
//
//   node scripts/build-city-pages.mjs           write every page listed in data/city-pages.json
//   node scripts/build-city-pages.mjs --check   write nothing; exit 1 if any page on disk differs
//
// Why generated: Jonny wants one page per city for Quality Score ("piano lessons irvine" should
// land on a page about Irvine), and he wants them kept in sync (2026-10-22). Hand copies of a
// 1,100-line page drift the first time someone edits the region page, so the region page IS the
// template: change it, run this, and every city page follows. `npm test` runs --check, so a
// forgotten rebuild fails before it can ship.
//
// Every rule below must match. A region page that no longer contains a phrase a rule expects
// stops the build with the rule's name instead of silently shipping a page that still talks
// about the whole region. After the rules run, the page is scanned for any OTHER city of the
// region outside the protected lines (footer, who-it-is-for list, site-wide schema), so a new
// sentence listing the cities cannot slip through either.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.musicandmastery.com/';
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'city-pages.json'), 'utf8'));

export function pageFile(page) {
  return `${page.instrument}-lessons-${DATA.cities[page.city].slug}.html`;
}

export function sourceFor(page) {
  const region = DATA.cities[page.city].region;
  const hit = Object.entries(DATA.sources)
    .find(([, s]) => s.region === region && s.instrument === page.instrument);
  if (!hit) throw new Error(`no region page for ${page.instrument} in ${region}`);
  return hit[0];
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// "Irvine, Newport Beach and Tustin", "Irvine, Newport Beach or Tustin", "Irvine, Newport
// Beach &amp; Tustin": any run of two or more of the region's cities joined by a list separator.
function listRegex(cities) {
  const alt = [...cities].sort((a, b) => b.length - a.length).map(esc).join('|');
  const sep = '(?:, and |, or |, | and | or | &amp; | & )';
  return new RegExp(`(?:${alt})(?:${sep}(?:${alt}))+`, 'g');
}

// Lines the city page keeps exactly as the region page has them: the footer (site-wide), the
// who-it-is-for list (it says who we can and cannot serve, region-wide, and the next line counts
// "the three cities above"), and the Organization schema's areaServed (the business, not the page).
const PROTECTED = /footer-cities|footer-areas|footer-lessons|qualify-mark|\{"@type": "City"/;

function replaceOnce(html, label, from, to, { min = 1 } = {}) {
  const re = typeof from === 'string' ? new RegExp(esc(from), 'g') : from;
  const n = (html.match(re) || []).length;
  if (n < min) throw new Error(`rule "${label}": expected at least ${min} match(es), found ${n}`);
  return html.replace(re, to);
}

export function buildPage(page, sourceHtml) {
  const src = sourceFor(page);
  const { region: rk, instrument: inst } = DATA.sources[src];
  const region = DATA.regions[rk];
  const city = page.city;
  // A page for a city its region does not serve would say "we come to homes all over <city>"
  // while the same page's who-it-is-for list names only the region's cities (code review 2026-10-23).
  if (!region.cities.includes(city)) throw new Error(`${city} is not one of ${region.label}'s cities (${region.cities.join(', ')}); add it to the region first`);
  const hoods = DATA.cities[city].neighborhoods;
  const file = pageFile(page);
  const Inst = cap(inst);
  let h = sourceHtml;

  // 1. Self references: canonical, og:url and the Service schema url point at the city page.
  h = replaceOnce(h, 'self url', `${SITE}${src}`, `${SITE}${file}`, { min: 2 });

  // 2. Region name, only in the places it means "the area this page serves".
  h = replaceOnce(h, 'title/og/twitter', ` in ${region.label} | Music and Mastery`, ` in ${city} | Music and Mastery`, { min: 3 });
  h = replaceOnce(h, 'service name', `"name": "In-Home ${Inst} Lessons in ${region.label}"`, `"name": "In-Home ${Inst} Lessons in ${city}"`);
  h = replaceOnce(h, 'promo bar', `${inst} lessons across ${region.label}`, `${inst} lessons in ${city}`);
  h = replaceOnce(h, 'eyebrow', `>${region.label}, CA<`, `>${city}, CA<`);
  h = replaceOnce(h, 'reading h2', new RegExp(`<h2>What ${esc(region.label)} (Parents|Families) Are Reading</h2>`, 'g'), `<h2>What ${city} $1 Are Reading</h2>`);
  h = h.replace(new RegExp(`${inst} lessons (?:near you )?in ${esc(region.label)}\\. From`), `${inst} lessons near you in ${city}. From`);

  // 3. The coverage FAQ, visible and FAQPage schema, becomes a yes for this city. Runs before the
  //    city-list rule so "That means Irvine, Newport Beach and Tustin." never becomes "That means Irvine."
  const list = listRegex(region.cities).source;
  h = replaceOnce(h, 'faq question', `Which ${region.label} cities do you cover for in-home ${inst} lessons?`,
    `Do you come to homes in ${city} for ${inst} lessons?`, { min: 2 });
  h = replaceOnce(h, 'faq answer',
    new RegExp(`We come to homes (?:all over ${esc(region.label)}\\. That means |in )(?:${list})\\. Each lesson`, 'g'),
    `Yes. We come to homes all over ${city}. Each lesson`, { min: 2 });

  // Two list sentences read wrong with one city in them, so they get their own wording first.
  h = h.replace(new RegExp(`across (?:${list})`, 'g'), `in ${city}`);
  h = h.replace(new RegExp(`We come to (?:${list})\\.`, 'g'), `We come to homes all over ${city}.`);

  // 4. Every remaining list of the region's cities names this city, except on protected lines.
  const re = listRegex(region.cities);
  let listed = 0;
  h = h.split('\n').map((line) => {
    if (PROTECTED.test(line)) return line;
    return line.replace(re, () => { listed += 1; return city; });
  }).join('\n');
  if (listed < 4) throw new Error(`rule "city lists": expected at least 4 lists of ${region.label} cities, found ${listed}`);

  // 5. The Service schema's areaServed shrinks to this city.
  h = replaceOnce(h, 'service areaServed',
    /(\n[ \t]*)\{ "@type": "City", "name": "[^"]+" \}(?:,\n[ \t]*\{ "@type": "City", "name": "[^"]+" \})+/g,
    `$1{ "@type": "City", "name": "${city}" }`);

  // 6. The one sentence written for this city: its neighborhoods, so the page is about the place
  //    and not the region page with a name swapped in.
  const hoodLine = `${hoods[0]} and ${hoods[1]} to ${hoods[2]} and ${hoods[3]}`;
  h = replaceOnce(h, 'local sentence', `We bring private ${inst} lessons to homes in ${city}.`,
    `We bring private ${inst} lessons to homes all over ${city}, from ${hoodLine}.`);

  // 7. No headline test on a city page: it shows the region's current A, the test keeps running on
  //    the region page, and a crowned winner reaches every city page on the next build.
  h = replaceOnce(h, 'h1 test attrs', / data-hl-test="[^"]*" data-hl-b="[^"]*"/g, '');
  h = replaceOnce(h, 'h1 test script', /\n[ \t]*<!-- Headline test[^\n]*-->\n[ \t]*<script>\(function\(\)\{var h=document\.currentScript\.previousElementSibling;[^\n]*<\/script>/g, '');

  // 8. The booking form opens on this city, the way the single-city pages do.
  // The comment above the region page's line explains why IT cannot prefill a city; on a city
  // page that is backwards, so it goes with the line.
  h = h.replace(/<!--(?:(?!-->)[\s\S])*?-->\n(<script>window\.MCMC_AREA_LABEL)/, '$1');
  h = replaceOnce(h, 'widget city', `<script>window.MCMC_AREA_LABEL = '${region.label}';</script>`,
    `<script>window.MCMC_PREFILL_CITY = '${city}';</script>`);

  // The hero rule above is a plain replace on purpose (OC heroes list the cities instead and the
  // city-list rule rewrites them), so check the result instead: the hero must name this city. A
  // reworded region hero once left three LA city pages saying "near you in Los Angeles".
  const hero = h.split('\n').find((l) => l.includes('class="hero-sub'));
  if (!hero || !hero.includes(`near you in ${city}.`)) throw new Error(`rule "hero line": the hero does not say "near you in ${city}." (${(hero || 'no hero-sub line').trim().slice(0, 120)})`);

  // 9. Stamp it, so nobody hand-edits a page the next build overwrites.
  h = replaceOnce(h, 'stamp', /<head>\n/, `<head>\n    <!-- GENERATED from ${src} by scripts/build-city-pages.mjs (data/city-pages.json). Do not edit this file; edit the region page, then run npm run build:city. -->\n`);

  // Guard: no other city of the region is left talking outside protected lines and comments.
  const others = region.cities.filter((c) => c !== city && !(c.endsWith('Hollywood') && city === 'Hollywood'));
  const visible = h.replace(/<!--[\s\S]*?-->/g, '').split('\n')
    .filter((l) => !PROTECTED.test(l) && !/^\s*\/\//.test(l));
  for (const other of others) {
    const hit = visible.find((l) => new RegExp(`\\b${esc(other)}\\b`).test(l.replace(/East Hollywood|West Hollywood/g, (m) => (other === 'Hollywood' ? '' : m))));
    if (hit) throw new Error(`${file}: still names ${other}: ${hit.trim().slice(0, 160)}`);
  }
  return h;
}

export function buildAll() {
  const out = new Map();
  const cache = new Map();
  for (const page of DATA.pages) {
    const src = sourceFor(page);
    if (!cache.has(src)) cache.set(src, fs.readFileSync(path.join(ROOT, src), 'utf8'));
    out.set(pageFile(page), buildPage(page, cache.get(src)));
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  let pages;
  try {
    pages = buildAll();
  } catch (e) {
    console.error(`city pages: build failed: ${e.message}`);
    process.exit(1);
  }
  const drift = [];
  for (const [file, html] of pages) {
    const p = path.join(ROOT, file);
    const current = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (current === html) continue;
    if (check) drift.push(file);
    else fs.writeFileSync(p, html);
  }
  // A page the build used to make but no longer does (its row left data/city-pages.json) would
  // stay live and in the sitemap, frozen. Every stamped page on disk must be one this build makes.
  const stale = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !pages.has(f)
    && fs.readFileSync(path.join(ROOT, f), 'utf8').includes('<!-- GENERATED from '));
  if (stale.length) {
    console.error(`city pages: ${stale.join(', ')} carry the GENERATED stamp but are no longer built. Delete them and their sitemap entries, or put them back in data/city-pages.json.`);
    process.exit(1);
  }
  if (check && drift.length) {
    console.error(`city pages: ${drift.length} out of date with their region page: ${drift.join(', ')}. Run: npm run build:city`);
    process.exit(1);
  }
  console.log(check ? `city pages: ${pages.size} in sync` : `city pages: built ${pages.size}`);
}

// realpath on both sides: called through a symlinked path (/tmp is /private/tmp on a Mac) the plain
// comparison was false, main() never ran, and --check exited 0 over real drift.
const invoked = (() => { try { return fs.realpathSync(process.argv[1]); } catch { return null; } })();
if (invoked && invoked === fs.realpathSync(fileURLToPath(import.meta.url))) main();
