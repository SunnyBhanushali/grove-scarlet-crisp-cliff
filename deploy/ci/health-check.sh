#!/usr/bin/env bash
# Public health check, run by GitHub Actions against the real HTTPS site.
#
#   health-check.sh <base url> [expected stamp]
#   env CHECK_USER / CHECK_PASSWORD  — a real sign-in (skipped only if both empty
#                                      AND ALLOW_NO_SIGNIN=1)
#
# Passes only when:
#   1. GET /                      -> 200 and the SPA HTML
#   2. its apms-sync.js?v=<stamp> == expected stamp (when given)
#   3. GET /api/company signed out -> 401 (the contract's lock still holds)
#   4. POST /api/auth/sign-in/username -> 200 with a session token
#   5. GET /api/company with that token -> 200
#   6. sign-out (the token is revoked again)
# Retries for up to HEALTH_WAIT seconds (default 90) before failing.
set -Eeuo pipefail

BASE="${1:?base url}"
BASE="${BASE%/}"
WANT_STAMP="${2:-}"
WAIT="${HEALTH_WAIT:-90}"
UA="apms-deploy-check/1 (+github-actions)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "::error title=Health check failed::$*"
  echo "HEALTH CHECK FAILED: $*" >&2
  exit 1
}
ok() { echo "  ok  $*"; }

deadline=$(( $(date +%s) + WAIT ))
attempt=0
while :; do
  attempt=$((attempt + 1))
  code="$(curl -sS -o "$TMP/home.html" -w '%{http_code}' --max-time 20 -A "$UA" -H 'Accept: text/html' "$BASE/" || echo 000)"
  stamp="$(grep -o 'apms-sync\.js?v=[A-Za-z0-9._-]*' "$TMP/home.html" 2>/dev/null | head -n1 | sed 's/.*v=//' || true)"
  if [ "$code" = "200" ] && { [ -z "$WANT_STAMP" ] || [ "$stamp" = "$WANT_STAMP" ]; }; then break; fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    [ "$code" = "200" ] || fail "$BASE/ answered HTTP $code after ${WAIT}s"
    fail "$BASE/ serves stamp '${stamp:-none}', expected '$WANT_STAMP' (old build still answering?)"
  fi
  echo "  …  attempt $attempt: HTTP $code, stamp '${stamp:-none}' — retrying"
  sleep 5
done
ok "GET / -> 200"
if [ -n "$WANT_STAMP" ]; then ok "apms-sync stamp $stamp matches the build"; else ok "apms-sync stamp ${stamp:-none}"; fi
echo "stamp=${stamp}" >>"${GITHUB_OUTPUT:-/dev/null}"

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -A "$UA" "$BASE/api/company" || echo 000)"
[ "$code" = "401" ] || fail "signed-out GET /api/company answered $code, must be 401"
ok "signed-out /api/company -> 401"

if [ -z "${CHECK_USER:-}" ] || [ -z "${CHECK_PASSWORD:-}" ]; then
  [ "${ALLOW_NO_SIGNIN:-0}" = "1" ] || fail "CHECK_USER / CHECK_PASSWORD secrets are not set — cannot do the sign-in check"
  echo "::warning::sign-in check skipped (no deploy-check login configured for this target yet)"
  exit 0
fi

jq -n --arg u "$CHECK_USER" --arg p "$CHECK_PASSWORD" '{username: $u, password: $p}' >"$TMP/body.json"
code="$(curl -sS -o "$TMP/signin.json" -w '%{http_code}' --max-time 30 -A "$UA" \
  -H 'Content-Type: application/json' --data-binary @"$TMP/body.json" "$BASE/api/auth/sign-in/username" || echo 000)"
rm -f "$TMP/body.json"
if [ "$code" != "200" ]; then
  msg="$(jq -r '.message // .code // empty' "$TMP/signin.json" 2>/dev/null || true)"
  fail "sign-in as the deploy-check login answered $code ${msg:+($msg)}"
fi
token="$(jq -r '.token // .session.token // empty' "$TMP/signin.json")"
[ -n "$token" ] || fail "sign-in returned 200 without a session token"
echo "::add-mask::$token"
ok "sign-in as the deploy-check login -> 200"

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 -A "$UA" --compressed \
  -H "Authorization: Bearer $token" "$BASE/api/company" || echo 000)"
curl -sS -o /dev/null --max-time 20 -A "$UA" -X POST -H "Authorization: Bearer $token" "$BASE/api/auth/sign-out" || true
[ "$code" = "200" ] || fail "signed-in GET /api/company answered $code, expected 200"
ok "signed-in /api/company -> 200 (then signed out)"
echo "HEALTH CHECK PASSED for $BASE"
