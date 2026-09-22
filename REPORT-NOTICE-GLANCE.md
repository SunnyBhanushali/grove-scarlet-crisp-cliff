# REPORT-NOTICE-GLANCE

## Status
done in this tree. 19 Sep 2026 22:52 IST. Stamp **p0as37**. Not deployed.

## Rule
Bell number = notices + EO alerts that this user has **not glanced**.

- Opening the tray glances only items actually on screen (scroll for the rest).
- Clicking one glances that one.
- Opening the bell does **not** clear the whole count.
- Glance list is localStorage (`apms-glanced-v1:{userId}`). Not written to the DB.

Open notices still sort to the top of the tray.

## Tests
access-roles-list **8/8 pass**

## HANDOFF
NOTICE-GLANCE done in tree (p0as37). Hard-refresh. Not Step 8.
