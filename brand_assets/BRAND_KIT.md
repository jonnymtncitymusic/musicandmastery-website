# Music & Mastery Brand Kit (Single Source of Truth)

Last updated 2026-06-28. This is the canonical brand kit. Music & Mastery (M&M) is the public-facing brand; Mountain City Music Co. (MCMC) is the legal parent company. Both brands share this exact visual system. The ONLY difference between them is the logo (M&M uses the clef + shooting-star mark below; MCMC keeps its "MC" mark).

## Logo

Files live in `brand_assets/logo/`:

| File | What it is | Use on |
|---|---|---|
| `mm-logo-primary.png` | Full lockup: black clef + gold star + black "Music & Mastery" (transparent) | Light backgrounds |
| `mm-logo-reversed.png` | Full lockup: white clef + gold star + white wordmark (transparent) | Dark and purple backgrounds |
| `mm-icon.png` | Icon only (black clef + gold star), transparent | Light backgrounds |
| `mm-icon-reversed.png` | Icon only (white clef + gold star), transparent | Dark and purple backgrounds |
| `mm-icon-512.png` | 512px app icon (transparent) | App tiles, large favicons |
| `mm-apple-touch-180.png` | 180px (transparent) | Apple touch icon |
| `mm-favicon-64.png` / `mm-favicon-32.png` | Small favicons (transparent) | Browser tab |
| `masters/` | Original source PNGs from the designer (baked white/black backgrounds) | Reference / re-derivation only |

### Usage rules (HARD)

- Light background (white, off-white `#f9f8ff`, cream/beige `#eae4dc`): use the PRIMARY (black) logo.
- Dark background AND purple background: use the REVERSED (white) logo. Purple ALWAYS gets the white reversed logo.
- Never pair: black logo on black, white or black logo on white/beige, or the black logo on purple.
- Keep generous clear space. The lockup already ships with airy spacing between the mark and the wordmark; do not crowd it.
- At very small favicon sizes (32px and under) the thin clef gets faint. If a tab favicon ever looks too wispy, request a bolder simplified favicon.

## Colors

The palette is intentionally tight: PURPLE + GOLD + neutrals. Red-orange has been retired (2026-06-28).

| Role | Hex | Notes |
|---|---|---|
| Dark purple (primary brand) | `#726edd` | Primary brand color, headlines, accents |
| Deep purple (actions) | `#4f4ab8` | Buttons / links, where white text needs AA contrast |
| Light purple | `#e4e3ff` | Tints, soft backgrounds |
| Gold (premium accent) | `#c6954f` | From the logo star/ampersand. Highlights, underlines, premium flourish |
| Black / ink | `#0d0d0d` | Text, primary logo |
| Off-white | `#f9f8ff` | Light section backgrounds |
| Cream / paper | `#eae4dc` | Warm light background |
| White | `#ffffff` | |

Roles: purple = primary action color (buttons, links) and main brand color; gold = premium accent only (do not use gold for large text on light backgrounds, it lacks contrast). Use deep purple `#4f4ab8` for button/link backgrounds so white text passes contrast.

## Type

- Display / headings / logo wordmark: Cormorant Garamond (high-contrast serif). This replaces Montserrat as the display face.
- Body: Work Sans (modern grotesque, full weight range). This replaces Questrial as the body face.
- Cormorant Garamond is delicate at small sizes; use it for the logo and large display headings only, and keep body copy in Work Sans.
- Both are free Google fonts and should be self-hosted as woff2 (same pattern as the current fonts) when reflected onto the sites.

## History / corrections

- The previous `BRAND_KIT.md` in `mtncitymusic-website/brand_assets/` listed a blue palette (`#15aeea` etc.) and Archivo/Gabarito fonts. That was stale and WRONG. The real, live brand is the purple palette and Montserrat/Questrial above. Montserrat is now being retired as the display face in favor of Cormorant Garamond.
