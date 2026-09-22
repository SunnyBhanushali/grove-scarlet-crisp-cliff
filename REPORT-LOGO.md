# REPORT-LOGO

**When:** 20 Sep 2026 15:05 IST  
**Stamp:** routes **p0as61**, brand.css **p0as61**, sync still **p0as60**  
**Host:** https://apms.alienstattoo.in (production). Do not deploy from this agent.

## What

Sunny’s lockup (black alien skull | APMS) is the product mark. The old 3D skull + extra Poppins “APMS” is gone so the word is not drawn twice.

| Surface | Treatment |
|---------|-----------|
| Login | Full lockup, 52px tall |
| Sidebar rail | Full lockup, 32px |
| Mobile/header bar | Full lockup, 28px (max-width 140px) |
| Tab favicon | Skull only, cream tile, hand SVG |
| Home-screen icon | Skull on cream 180px |
| Share card | Cream 1200×630, lockup centered |

No extra “APMS” text next to the lockup. `fallbackPost` untouched. G9 / TAB PERF untouched.

## Files

- `public/aliens-logo.png` — trimmed lockup, ink on transparent
- `public/aliens-mark.png` — skull only
- `public/favicon.svg`
- `public/og.jpg` (1200×630, 20 KB)
- `public/__grok/icon-180.png`
- `public/assets/apms-brand.css`
- `routes-e2g7y5q8-13m-p0ar.js` `Brand()`
- `login-view-f2j6t0x4-11a3-p0ar.js` login card

## Tests

access-roles-list, company-perf-tab, g9-two-client, target-mass: **30/30 pass**. `node --check` routes + login-view. brand-check **ok**.

## HANDOFF

Tree **p0as61** (routes + brand). Sync **p0as60**. Live still **p0as39 / p0as14**.  
Hard refresh `routes-…p0ar.js?v=p0as61` and `apms-brand.css?v=p0as61`.  
Do not start roster / Step 8. Eng cut when named.
