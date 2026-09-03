# CLAUDE.md — Music and Mastery Website Rules

## Project Identity
**Music and Mastery** is a DBA of the same parent business that operates Mountain City Music Co. (MCMC). This site targets **Orange County and Los Angeles**:
- **OC branch (5 cities):** Irvine, Newport Beach, Costa Mesa, Lake Forest, Tustin
- **LA branch (7 cities):** Beverly Hills, West Hollywood, East Hollywood, Burbank, Pasadena, Pacific Palisades, Malibu

Landing pages cover **all instruments** (guitar, piano, voice, bass, ukulele, drums, music production) — **not guitar-specific** like the MCMC `beginner-*.html` pages.

## Shared With MCMC (do NOT change)
- Phone: `(760) 573-2120` / `+17605732120`
- Email: `jonny@mtncitymusic.com`
- Google Ads tag: `AW-11066542604`
- GA4 Measurement ID: `G-SPQ1FGTKTV`
- JotForm ID: `260516786213155` (used on **all M&M pages** — index, instructors, and all 24 location pages) — reused across brands via a hidden `brand_source` URL param. M&M does not use the guitar-specific form `260520648689164` that MCMC location pages use, because M&M launches generic music lessons.
- Instagram: `@mountain_city_music`
- TikTok: `@mountain_city_music`
- Brand system (REBRANDED 2026-06-28): M&M logo = treble clef + gold shooting-star (files in `brand_assets/logo/`). Palette is PURPLE + GOLD + neutrals: `--dark-purple #726edd` (primary), `--accent #4f4ab8` (deep purple, buttons/links), `--light-purple #e4e3ff` (tints), `--gold #c6954f` (premium accent), `--cream #f6f1e8` / `--cream-deep #efe7d8` (warm section backgrounds), `--black #0d0d0d`, `--off-white #f9f8ff`. Red-orange (`#d63e0d`) is RETIRED, do not reintroduce it. Fonts: Playfair Display (display/headings) + Work Sans (body). Hero/warm sections use the cream-to-soft-lavender gradient `linear-gradient(125deg, #f7f2ea 0%, #f1ece2 45%, #e7e3f6 100%)`. The canonical brand kit is `brand_assets/BRAND_KIT.md`.

## Domain
Placeholder: `https://www.musicandmastery.com` — all canonical URLs, OG URLs, sitemap, schema.org URLs point here. If the final domain differs, do a global find/replace.

## Always Do First
- **Invoke the `frontend-design` skill** before writing any frontend code (when doing new design work — not for text/branding edits).
- **Changing any customer-facing WORD? Read `~/.claude/skills/marketing-expert/references/website-copy.md` first.** This file governs markup and design; that one governs copy. Until 2026-08-16 this file carried no copy standard at all, which is how the FAQ ended up refusing to state a published price and the instructors page ended up recruiting for Orange County only while the site sells to 7 LA cities.

## Copy rules (the short version — the full playbook is `website-copy.md`)

These are business rules, not style preferences. They beat any design instinct.

| Rule | What it means here |
|---|---|
| **Lead with the outcome, not the offer or the mechanics** | The first screenful names something the visitor wants. The 6 `*-lessons-orange-county.html` pages are the reference implementation: one concrete, instrument-specific dream line each. Background checks, no-commute and the free lesson are PROOF and come after. |
| **No promised rate of progress, ever** | Banned: "progress happens fast", "you'll be amazed at what a few months can do", "we prove it every week", any number of weeks. Approved: "sooner than they expect". |
| **The offer is ONE FREE FIRST LESSON** | Not a "trial", and never plural. "Book Your Trial Lessons" was a fossil of a retired 50%-off-3-lessons offer and survived on 53 buttons here. |
| **Pricing is 60/$300, 45/$240, 30/$160, quoted MONTHLY, most-expensive-first** | Identical to Mountain City's ladder by decision (2026-08-11) while M&M establishes itself; the premium positioning is not cancelled, it is unfunded until the proof carries it. Never quote a per-lesson price. |
| **Attribution is load-bearing on this brand** | M&M has no testimonial of its own. Every citation of a Mountain City review must say in the same block that the two are one company, and every stat bar leads with "Mountain City Music Co.". Do not strip that for tidiness. |
| **This brand serves BOTH Orange County and Los Angeles** | 5 OC cities and 7 LA cities, 24 city landing pages. Any page that names only OC is wrong. |
| **No invented specifics, no internal contradictions, no fabricated scarcity** | "Right now Jonny is the only instructor" is real capacity and fine. "Limited spots" is not. |
| **No em dashes. No exclamation on a sales line.** | Run `bash scripts/install-hooks.sh` once per clone — the em-dash guard is a real script but the hook is untracked and was missing from this clone until 2026-08-16. |
| **Review quotes are verbatim and never edited** | The 2026-07-30 restoration (487 changes, 27 files) put these right. Do not re-touch them. |

**Surfaces a `*.html` edit misses:** `js/scheduling-widget.js` (~40 customer-facing strings, and
changing it REQUIRES the `?v=` bump documented at the bottom of this file); the `FAQPage` and
`Person` JSON-LD, which mirror the FAQ answers and the founder bio; `<title>` and
`meta description` on all 38 pages; `alt` and `aria-label` text.

**This site mirrors `mtncitymusic.com` on purpose.** The mirror is deliberate, but fixes do NOT
propagate on their own. When you fix copy here, check the sibling repo in the same pass.

## Local Server
- Dev server: `node serve.mjs` → `http://localhost:3001` (note: 3001, not 3000 — 3000 is reserved for the MCMC site so both can run simultaneously).
- `serve.mjs` lives in the project root. Start it in the background before taking any screenshots.
- If the server is already running, do not start a second instance.

## Screenshot Workflow
- Puppeteer is installed via npm (run `npm install` first — node_modules was not copied from MCMC).
- **Always screenshot from localhost:** `node screenshot.mjs http://localhost:3001`
- Screenshots save to `./temporary_screenshots/screenshot-N.png` (auto-incremented).
- Optional label suffix: `node screenshot.mjs http://localhost:3001 label`
- After screenshotting, read the PNG with the Read tool to analyze visually.

## Project State
- **Live production site** (when deployed via Vercel) — not a design exercise.
- Files in project root: `index.html`, `instructors.html`, `faq.html`, 12 `beginner-*.html` city pages, 12 `in-home-*.html` city pages, 6 `*-lessons-orange-county.html` instrument pages, plus `privacy-policy.html`, `terms-of-service.html`, `thank-you.html`, `banner.html`, `flyer.html`.
- **No build step.** All CSS is inline `<style>` blocks per page. No Tailwind, no PostCSS.
- **Do NOT add Tailwind via CDN.** The MCMC site removed it for performance reasons. The inline `<style>` block starts with a "Baseline reset" that replaces the preflight subset the pages relied on — keep those rules.

## External Resources — What's Hosted Where
- **Fonts are self-hosted.** Playfair Display (600/700/800) and Work Sans (variable 400-700) live as woff2 files in `brand_assets/fonts/` (`playfair-display-*-latin.woff2`, `worksans-latin.woff2`), declared via `@font-face` in each page. Display/headings use Playfair Display; body and UI use Work Sans. Do NOT re-add Google Fonts `<link>` tags. (Legacy Montserrat/Questrial/Cormorant woff2 may still sit in the folder but are no longer used.)
- **Hero image uses `<picture>` with WebP + JPEG fallback.** `brand_assets/Home_Page_Image.webp` (84 KB, preferred) falls back to `Home_Page_Image.jpg` on browsers without WebP.
- **Videos: YouTube embeds only, never Google Drive.** Existing pages use `https://www.youtube.com/embed/y5hxyfuIbOs` for the "About our Lessons" VSL.
- **Keep `loading="lazy"`** on all iframes (JotForm, YouTube).
- **JotForm embed handler** is loaded via `<script defer src="https://cdn.jotfor.ms/s/umd/latest/for-form-embed-handler.js">` and initialized inside a `DOMContentLoaded` listener.

## Brand Assets
- `brand_assets/` — logos, fonts, hero images, instrument photos, instructor photos (all inherited from MCMC).
- Logos (in `brand_assets/logo/`): `mm-logo-primary.png` (black clef + gold star + wordmark, for LIGHT backgrounds), `mm-logo-reversed.png` (white version, for DARK/purple backgrounds), `mm-icon.png` / `mm-icon-reversed.png` (mark only), `mm-favicon-64.png` / `mm-apple-touch-180.png` / `mm-icon-512.png`. Old MCMC-clone logos were archived to `brand_assets/_archive-mcmc-logos/`.
- Logo usage rule: light bg = primary (black) logo; dark AND purple bg = reversed (white) logo. Never black-on-purple.
- The nav uses `mm-icon.png` + a Playfair "Music & Mastery" wordmark (gold ampersand), not a single image.
- When referenced in HTML, logo alt text should say "Music and Mastery" (not "Mountain City Music Co.").

## JotForm — brand_source hidden field
Both M&M and MCMC's index/instructors pages use JotForm `260516786213155`. M&M pages pass `?brand_source=Music%20and%20Mastery` on the iframe `src` (the form must have a matching hidden field for this to land in the submission). MCMC pages keep their current URL (no param). This lets lead routing/reporting distinguish brands without splitting forms. Since M&M consolidated to this single form (2026-04-21), you only need the `brand_source` hidden field on form `260516786213155` — not the guitar-specific `260520648689164` which M&M no longer uses.

## Anti-Generic Guardrails
- **Colors:** Use `--dark-purple`, `--accent` (deep purple buttons), `--light-purple`, `--gold` (premium accent only), `--cream` / `--cream-deep`, `--black`, `--off-white`. No red-orange, no framework-default blue/indigo.
- **Shadows:** Layered, color-tinted, low opacity (see `.btn-primary` pattern).
- **Typography:** Playfair Display for display/headings, Work Sans for body and UI. `1.7` line-height on body.
- **Animations:** Only animate `transform` and `opacity`. Never `transition: all`. Spring easing: `cubic-bezier(0.34, 1.2, 0.64, 1)`.
- **Interactive states:** Every clickable element needs hover, focus-visible, active.
- **Spacing:** 16/24/32/48/64/96px increments.

## Hard Rules
- Do not use `transition: all`
- Do not use generic framework blue/indigo
- **Never add** `<script src="https://cdn.tailwindcss.com"></script>`
- Do not commit or push to GitHub until explicitly told to
- Always test on localhost first

## Scheduling widget cache-busting (REQUIRED on every widget change)

`/js/scheduling-widget.js` is served `public, max-age=31536000, immutable` (see
`vercel.json`) and has no content hash. `immutable` means a returning visitor's browser
reuses its cached copy for a year and never revalidates, so the version query param is the
ONLY thing that can deliver a widget change to someone who has already visited. Every
include therefore carries a version query param:

    <script src="/js/scheduling-widget.js?v=20260729"></script>

**When you change `js/scheduling-widget.js`, you MUST bump that `?v=` token in every HTML
file that references it, or returning visitors never receive the change.** This bit for real:
a stale widget sent no `lesson_for` field at all, and was only survivable because the backend
has a neutral branch. Bump with a sweep, not by hand:

    python3 - <<'EOF'
    import pathlib, re
    NEW = "YYYYMMDD"
    for f in pathlib.Path(".").glob("*.html"):
        t = f.read_text()
        n = re.sub(r'(/js/scheduling-widget\.js\?v=)[0-9]+', rf'\g<1>{NEW}', t)
        if n != t: f.write_text(n); print(f.name)
    EOF

Note one include is injected dynamically via `s.src = '/js/scheduling-widget.js?v=...'`, so a
naive grep for `<script src=` will miss it. The regex above catches both forms.

**Same-day second bump:** the sweep regex is digit-only (`[0-9]+`), so if the token already
carries today's date, re-running with `YYYYMMDD` silently changes nothing and every returning
visitor keeps the old widget. Use a `YYYYMMDDNN` suffix instead (`2026081902`). Do not reach for
tomorrow's date: a session running tomorrow would bump to it and collide, producing the same
silent no-op. Always confirm the sweep afterwards with
`grep -rhoE '/js/scheduling-widget\.js\?v=[0-9]+' --include='*.html' . | sort | uniq -c`,
which should report one token across all includes.
