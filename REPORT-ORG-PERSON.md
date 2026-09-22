# REPORT-ORG-PERSON

## Status
done in this tree. 19 Sep 2026 22:48 IST. Stamp **p0as36**. Not deployed.

## Org default
Sidebar **Org** opens **People**, not Overview. Overview is still a sub-tab.

## Same person, two routes
Manager file → Team → teammate kept the **previous form in memory**. People search → Edit loaded the real record.

Fix: remount Ul/Bl on `person.id`. Leave edit mode unless the pencil set `personStartEdit`.

## Tests
access-roles-list **7/7 pass**

## HANDOFF
ORG-PEOPLE-DEFAULT + PERSON-FILE-ID done in tree (p0as36). Hard-refresh. Not Step 8.
