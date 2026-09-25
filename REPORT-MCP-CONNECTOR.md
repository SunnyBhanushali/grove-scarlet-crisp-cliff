# REPORT — MCP-CONNECTOR (Claude reads APMS)

25 Sep 2026 IST. Branch `mcp-connector` (from `perf-2`, tree p0as83 / server p0aw5).
Server-only change: **no SPA bundle, stamp or sync change**. Pack `aliens-apms-p0as84-mcp.zip`.

## 1. What it is

A read-only **MCP connector** built into the APMS server. You add it to Claude as a custom connector
with the URL **`https://apms.alienstattoo.in/mcp`** and sign in with an APMS username and password.
After that, Claude can read APMS in any chat: people, org, roles, KPIs, APMS plans and scores,
Rewards payouts, Targets, Awards, Roster, notices, MIS report definitions and Settings.

- **Read-only.** No tool writes anything. Every tool is marked `readOnlyHint`.
- **Same visibility as the app.** Every tool reads the company snapshot exactly as GET `/api/company`
  sends it to that login's browser (`apms-permissions` `filterSnapshot`, the BATCH-3 per-viewer wire).
  Month lists (APMS / Rewards / EO / KPI scores) are further limited to the login's team / function /
  company scope, like the Plans pages. Roster: HR and admins see everyone, others only their own rows.
  Backups: only with Settings → Backup rights.
- **Same maths as the screens.** The SPA computes scores and payouts in the browser; `scoring.ts` ports
  those functions (KPI 0–5, KRA / brand / plan KPI score, EO, values, P-score + values drag, rating,
  target roll-up incl. locked snapshots, milestone, pot, KPI multiplier, qualifiers / DQ, quarter and
  year roll-up with true-up and consistency). Checked against the **shipped bundle's own functions**
  (`scripts/mcp-bundle-parity.mjs`): 29 Rewards months, 53 APMS plans, 172 Rewards years — **0 differences**.

## 2. Tools (one per page / module)

| App page | Tool | What it returns |
|---|---|---|
| — | `apms_whoami` | signed-in person, access role, scope, visible modules |
| Home | `apms_overview` | headcount by status / SBU / function; APMS + Rewards month progress, avg P-score, total earned; target month status; alerts |
| Org → People / Me | `apms_search_people`, `apms_get_person` | filters (SBU, brand, function, manager + whole team, role, status); profile, manager chain, reports, role history, slabs (if pay visible), P-score and payout by month |
| Org → Overview / Brands & SBUs / Functions | `apms_org_structure` | companies, brands, SBU tree + groups + headcount, functions tree + heads |
| Org → Roles | `apms_roles`, `apms_get_role` | roles with band / function / reports-to / holders; role KRAs, KPIs, competencies, AGS, slabs |
| Roster | `apms_roster` | month assignments (SBU, manager, line, allocation, dates), draft / current / locked |
| KPI → library / scores | `apms_kpi_library`, `apms_kpi_scores` | KPI master + values catalog; every KPI result across people for a month |
| APMS → Plans / My APMS | `apms_plans_month` | status, KPI / Exec / Values, P-score, rating, missing actuals — per person, with summary |
| Scorecard (APMS / Rewards) | `apms_scorecard` | full person-month plan: brand → KRA → KPI (target, floor, achieved, score), EOs, values; Rewards adds target ladder / actual, milestone, pot, multiplier, flags, earned |
| Role scorecard | `apms_role_plan` | a role's month plan (APMS or Rewards) |
| APMS → EO | `apms_execution` | execution outcomes over a month range |
| Quarterly review / AGS | `apms_reviews` | period reviews, AGS reviews, AGS months |
| Rewards → Plans / My rewards | `apms_rewards_month` | milestone, pot, multiplier, earned, DQ per person + totals |
| Rewards → person (quarter / year) | `apms_rewards_year` | FY months, quarters (true-up, consistency) and year total |
| Rewards → Targets | `apms_targets`, `apms_target_history` | target tree for a month (ladder, actual, % of M1, milestone, lock), gate units; change log |
| Rewards → Awards | `apms_awards` | programmes, eligibility, parameters, prizes, winners, prize catalog, band shares |
| MIS | `apms_mis_reports` | saved report + folder definitions (numbers come from the list tools) |
| Settings | `apms_settings` | access roles + grants, setup, trash, backups |
| Notices / Improve | `apms_notices` | notices feed, "Something missing?" requests, role cases |
| anything else | `apms_raw` | any stored section, paged (period-keyed sections by month) |

Names are resolved for people, roles, SBUs, brands, functions; people can be named by name, username,
employee code, email or id; months accept `2026-08`, `Aug 2026`, `august`, `last month`.
Replies are capped at 150 000 characters with paging (`limit` / `offset`).

## 3. Sign-in and security

- **OAuth 2.1** as Claude expects it: `/.well-known/oauth-protected-resource` (RFC 9728),
  `/.well-known/oauth-authorization-server` (RFC 8414), dynamic client registration `/oauth/register`
  (RFC 7591), `/oauth/authorize` (APMS username + password page, **PKCE S256 required**), `/oauth/token`
  (code + refresh, refresh tokens rotate), `/oauth/revoke`.
- The **access token is an ordinary APMS session** (`apms_sessions`, 30 days): sign-out rules, admin
  password reset and own password change end it like a browser session. Refresh tokens (hashed,
  90 days, `apms_mcp_refresh`) die when the password changes (`issued_logins.updated_at`).
- Sign-in uses the app's own rules: `verifyLoginDetailedAsync`, lock-out 5 / username, 30 / IP per
  15 min (`apms-signin-guard`). **The starter password `0000` never connects Claude** (also `sunny.b`/`0000`),
  whatever `APMS_DEFAULT_PIN` says.
- **Who may connect:** `APMS_MCP_ALLOW` — default `admin` (super admin + admin-base access roles).
  `all`, or a list of access roles / bases (`admin,hr,function_head`) widens it. Checked at sign-in,
  on refresh and on every call.
- Redirects only to `claude.ai` / `claude.com` (+ loopback for testing; `APMS_MCP_REDIRECT_HOSTS` adds more).
  `/mcp` takes the token from the `Authorization` header only (no cookies → no CSRF); browser calls
  from other sites are refused (Origin check). Sign-in page: `X-Frame-Options: DENY`, strict CSP.
- Belt and braces: every reply is scrubbed of `password` / `passwordHash` / `pin` / token keys.
- Every tool call is logged: `[apms-mcp] <personId> <tool> <args> → ok|error <bytes> <ms>`.
- Off switch: `APMS_MCP=off` (all connector paths fall through to the app → 404).

## 4. Files

| File | |
|---|---|
| `src/lib/apms-mcp/scoring.ts` | port of the SPA score / payout / target / year maths (function names noted per bundle function) |
| `src/lib/apms-mcp/tools.ts` | the 24 tools |
| `src/lib/apms-mcp/protocol.ts` | MCP JSON-RPC over Streamable HTTP, stateless, JSON replies (no npm dependency) |
| `src/lib/apms-mcp/oauth.ts` | OAuth endpoints, sign-in page, memory + Postgres stores (tables created at runtime) |
| `src/lib/apms-mcp/http.ts` | router for `/mcp`, `/oauth/*`, `/.well-known/oauth-*` |
| `src/lib/apms-mcp/server.ts` | production wiring: app login, sessions, per-viewer wire, roster, backups, env switches |
| `server/middleware/03-apms-mcp.ts` | Nitro middleware (connector paths only; everything else `next()`) |
| `server/middleware/00-apms-spa.ts` | `/mcp` and `/oauth/*` no longer answered with the SPA HTML |
| `src/lib/apms-mcp/apms-mcp.test.ts` | tests (added to `npm test`) |
| `scripts/mcp-bundle-parity.mjs` | connector ⇄ shipped bundle maths check |

New runtime tables (no migration file needed; created on first use like `apms_sessions`):
`apms_mcp_clients`, `apms_mcp_codes`, `apms_mcp_refresh`.

## 5. Tested

- `apms-mcp.test.ts` — **10 / 10**: Claude's full flow (401 + `WWW-Authenticate` → discovery → registration →
  sign-in page → PKCE code → token → initialize / tools/list / tools/call → refresh rotation → password change
  kills refresh → revoke → 401); wrong password, deny, bad PKCE, missing PKCE, refused role; redirect allow-list;
  fall-through, `GET /mcp` 405, off switch, cross-site Origin 403; **all 24 tools on the seed company** (no error,
  under cap, no password field); Rewards payout rule; employee login sees only own plans / no one's pay / own
  roster rows / no backups; month parsing; scoring maths; Postgres OAuth store (real Postgres 16 via `mini-pg`).
- **Production path on real Postgres** with the app's own modules (not stubs): seed restored with
  `replaceCompanySnapshot`, logins via `upsertIssuedLogins`, then `handleApmsMcp`: `0000` refused, wrong password
  401, admin connects and reads (overview, rewards month, roster, backups), employee refused under the default
  allow list and scoped under `APMS_MCP_ALLOW=all`, **own password change → next call 401**.
- Parity with the shipped bundle: 0 differences (§1).
- Type check of the new files: clean (sandbox has no npm registry, so the full `npm run typecheck` / `vite build`
  was **not** run here — the deploy build must run them).

## 6. Deploy

1. Ship **with or after p0as82 + p0as83** (it relies on server sessions and server-side permissions). Live p0as39
   does not have them.
2. Build as usual (`npm install --include=dev && NITRO_PRESET=node-server npm run build:app`). No new dependency.
3. nginx must pass **`/mcp`, `/oauth/` and `/.well-known/oauth-`** to the Node app over HTTPS (a
   `location /.well-known/` block for certbot must not swallow `/.well-known/oauth-*`).
4. Optional env: `APMS_MCP_ALLOW`, `APMS_PUBLIC_URL=https://apms.alienstattoo.in` (if the proxy does not send the
   public Host / `X-Forwarded-Proto`), `APMS_MCP=off`.
5. Check: `curl https://apms.alienstattoo.in/.well-known/oauth-authorization-server` → JSON with `issuer`
   `https://apms.alienstattoo.in`; `curl -X POST https://apms.alienstattoo.in/mcp` → 401 with `WWW-Authenticate`.
6. In Claude: add a custom connector with URL `https://apms.alienstattoo.in/mcp`, sign in, ask a question.

## 7. Open / decisions for Sunny

- Who may connect (default admins only).
- Writes (e.g. enter an actual, lock a month) are deliberately not included; they can come later on top of the
  ROWS-V2 per-row PATCH with the same permission checks.
- MIS: saved report *definitions* are returned; running a saved pivot is left to Claude over the list tools.
- The Grok-side live preview is not an https origin Claude can reach; test the connector on staging (3010 behind
  https) or live.
