#!/usr/bin/env node
/**
 * Keeps the VSL player's two files current on every page (VSLs in signup, 2026-11-13).
 *
 *   node scripts/vsl-assets.mjs           rewrite the ?v= token of js/vsl-player.js and js/vsl-ids.js
 *                                         on every page to the file's current hash
 *   node scripts/vsl-assets.mjs --check   change nothing; fail on any of:
 *     - a stale ?v= token (/js/ is served immutable for a year, so a stale token strands returning
 *       visitors on the old player or the old video id);
 *     - a page with a data-vsl player that does not load vsl-ids.js BEFORE vsl-player.js;
 *     - a data-vsl key with no id in js/vsl-ids.js;
 *     - any key still listed in VSL_TEMP (a stand-in id must never go live).
 *
 * The same file on mtncitymusic.com and musicandmastery.com. Part of `npm test`.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const ASSETS = ['js/vsl-player.js', 'js/vsl-ids.js'];
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 10);
const tokens = Object.fromEntries(ASSETS.map(a => [a, hash(a)]));
const fails = [];

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/vsl-ids.js'), 'utf8'), sandbox);
const ids = sandbox.window.VSL_IDS || {};
const temp = sandbox.window.VSL_TEMP || [];

let changed = 0;
for (const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort()) {
  const file = path.join(ROOT, f);
  const t = fs.readFileSync(file, 'utf8');
  let n = t;
  for (const [asset, v] of Object.entries(tokens)) {
    const re = new RegExp(`(/${asset.replace(/\./g, '\\.')}\\?v=)([0-9a-f]+)`, 'g');
    if (CHECK) { for (const m of t.matchAll(re)) if (m[2] !== v) fails.push(`${f}: ${asset}?v=${m[2]} is stale, file is ${v} (run node scripts/vsl-assets.mjs)`); }
    else n = n.replace(re, `$1${v}`);
  }
  if (!CHECK && n !== t) { fs.writeFileSync(file, n); changed++; }

  const keys = [...t.matchAll(/class="hero-vsl[^"]*"[^>]*\bdata-vsl="([a-z0-9_]+)"/g)].map(m => m[1]);
  if (!keys.length) continue;
  if (keys.length > 1) fails.push(`${f}: ${keys.length} data-vsl players, the player drives one`);
  for (const k of keys) if (!ids[k]) fails.push(`${f}: data-vsl="${k}" has no id in js/vsl-ids.js`);
  const idsAt = t.indexOf('/js/vsl-ids.js?v='), playerAt = t.indexOf('/js/vsl-player.js?v=');
  if (idsAt < 0 || playerAt < 0) fails.push(`${f}: has a data-vsl player but does not load both js/vsl-ids.js and js/vsl-player.js with a ?v= token`);
  else if (idsAt > playerAt) fails.push(`${f}: loads js/vsl-player.js before js/vsl-ids.js`);
}
if (CHECK) for (const k of temp) fails.push(`js/vsl-ids.js: "${k}" is still a TEMP stand-in id (${ids[k]}). Put the real YouTube id in and remove the key from VSL_TEMP before this goes live.`);

if (!CHECK) console.log(`vsl-assets: ${changed} page(s) updated; ${ASSETS.map(a => `${a} v=${tokens[a]}`).join(', ')}`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
if (CHECK) console.log('vsl-assets: tokens current, players wired, no TEMP ids');
