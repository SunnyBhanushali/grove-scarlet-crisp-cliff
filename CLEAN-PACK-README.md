# Aliens APMS — clean pack (from live 2026-09-17)

Cut from the Contabo live tree after Eng no-remix rebuild.

## Included
- App source: `src/`, `public/`, `scripts/`, `server/`, configs
- Remix / `extensions.js` **disabled** — do not re-add the Grok remix pill
- No `node_modules`, `.output`, Drive `attachments`, `dist`, `recovered-site`, tool caches

## Locks (keep)
- `/api/company` anon → 401
- Live forgot: never `previewLink`; `needHr` on mail fail
- Username: `firstname` + `.` + first 4 of last
- Company GET: gzip + ETag
- Nitro: `node-server` for Contabo

## Rebuild
```
npm install --include=dev
NITRO_PRESET=node-server npm run build:app
```
Ship only `.output` + `package.json` + `package-lock.json` + `ecosystem.config.cjs`. Keep VPS `.env` + `aliens_apms` DB.

## Open P0
Full-snapshot last-write-wins (Org / Rewards / Targets / trash resurrection under concurrent editors).
