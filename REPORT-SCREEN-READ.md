# REPORT-SCREEN-READ

## Status
done in this tree. 20 Sep 2026 17:05 IST. Stamp **p0as72** (`routes-e2g7y5q8-13m-p0as72.js`, index `?v=p0as72`). **Not deployed.**

## Black screen (p0as70/71)
`SyntaxError: missing ) after argument list` — `function Au` was spliced into `ku()` author chips and ate `` `${e.personId}-${e.functionId}`))]})} ``. That is a missing `)` on `Q.jsxs`. Restored. New chunk filename so the browser cannot keep the broken module (index imported routes **without** `?v=`).

## Screen-read
People → GET `/api/people?limit=80`. Rewards month → GET `/api/reward-records/:period?limit=80`. After hydrate those screens do not GET `/api/company`. List watch lives in `apms-sync.js` (`maybeScreenRead`), not inside minified `rd`/`hs`.
