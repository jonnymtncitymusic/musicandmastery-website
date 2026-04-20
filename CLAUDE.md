# CLAUDE.md — Music and Mastery Website Rules

## Project Identity
**Music and Mastery** is a DBA of the same parent business that operates Mountain City Music Co. (MCMC). This site targets **Orange County and Los Angeles**:
- **OC branch (4 cities):** Irvine, Newport Beach, Costa Mesa, Tustin
- **LA branch (7 cities):** Beverly Hills, West Hollywood, East Hollywood, Burbank, Pasadena, Pacific Palisades, Malibu

Landing pages cover **all instruments** (guitar, piano, voice, bass, ukulele, drums, music production) — **not guitar-specific** like the MCMC `beginner-*.html` pages.

## Shared With MCMC (do NOT change)
- Phone: `(760) 573-2120` / `+17605732120`
- Email: `jonny@mtncitymusic.com`
- Google Ads tag: `AW-11066542604`
- GA4 Measurement ID: `G-SPQ1FGTKTV`
- JotForm ID: `260520648689164` (beginner pages) and whatever index.html uses — reused across brands via a hidden `brand_source` URL param
- Instagram: `@mountain_city_music`
- TikTok: `@mountain_city_music`
- Brand system: logo, palette (`--dark-purple #726edd`, `--light-purple #e4e3ff`, `--accent #fc4e1a`), fonts (Montserrat + Questrial)

## Domain
Placeholder: `https://www.musicandmastery.com` — all canonical URLs, OG URLs, sitemap, schema.org URLs point here. If the final domain differs, do a global find/replace.

## Always Do First
- **Invoke the `frontend-design` skill** before writing any frontend code (when doing new design work — not for text/branding edits).

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
- Files in project root: `index.html`, `instructors.html`, `faq.html`, 11 `beginner-*.html` city pages, 11 `in-home-*.html` city pages, plus `privacy-policy.html`, `terms-of-service.html`, `thank-you.html`, `banner.html`, `flyer.html`.
- **No build step.** All CSS is inline `<style>` blocks per page. No Tailwind, no PostCSS.
- **Do NOT add Tailwind via CDN.** The MCMC site removed it for performance reasons. The inline `<style>` block starts with a "Baseline reset" that replaces the preflight subset the pages relied on — keep those rules.

## External Resources — What's Hosted Where
- **Fonts are self-hosted.** Montserrat (variable, weight 400–900) and Questrial (400) live as woff2 files in `brand_assets/fonts/`, declared via `@font-face` in each page. Do NOT re-add Google Fonts `<link>` tags.
- **Hero image uses `<picture>` with WebP + JPEG fallback.** `brand_assets/Home_Page_Image.webp` (84 KB, preferred) falls back to `Home_Page_Image.jpg` on browsers without WebP.
- **Videos: YouTube embeds only, never Google Drive.** Existing pages use `https://www.youtube.com/embed/y5hxyfuIbOs` for the "About our Lessons" VSL.
- **Keep `loading="lazy"`** on all iframes (JotForm, YouTube).
- **JotForm embed handler** is loaded via `<script defer src="https://cdn.jotfor.ms/s/umd/latest/for-form-embed-handler.js">` and initialized inside a `DOMContentLoaded` listener.

## Brand Assets
- `brand_assets/` — logos, fonts, hero images, instrument photos, instructor photos (all inherited from MCMC).
- Logos: `Logo - Transparent & Black.png`, `Logo - White Background No Name.png`, `Logo - White Background.png`.
- When referenced in HTML, logo alt text should say "Music and Mastery" (not "Mountain City Music Co.").

## JotForm — brand_source hidden field
Both sites use the same JotForm. M&M pages pass `?brand_source=Music%20and%20Mastery` on the iframe `src` (the form must have a matching hidden field for this to land in the submission). MCMC pages keep their current URL (no param). This lets lead routing/reporting distinguish brands without splitting forms.

## Anti-Generic Guardrails
- **Colors:** Only `--dark-purple`, `--light-purple`, `--accent`, `--black`, `--off-white`. Never framework-default blue/indigo.
- **Shadows:** Layered, color-tinted, low opacity (see `.btn-primary` pattern).
- **Typography:** Montserrat for headings, Questrial for body. Tight tracking (`letter-spacing: -0.03em`) on large headings, `1.7` line-height on body.
- **Animations:** Only animate `transform` and `opacity`. Never `transition: all`. Spring easing: `cubic-bezier(0.34, 1.2, 0.64, 1)`.
- **Interactive states:** Every clickable element needs hover, focus-visible, active.
- **Spacing:** 16/24/32/48/64/96px increments.

## Hard Rules
- Do not use `transition: all`
- Do not use generic framework blue/indigo
- **Never add** `<script src="https://cdn.tailwindcss.com"></script>`
- Do not commit or push to GitHub until explicitly told to
- Always test on localhost first
