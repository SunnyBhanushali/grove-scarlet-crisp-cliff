-- Change feed carries the row payload for kinds that do not live in `entities`
-- (people / month-records / reward-records / target-cells), so followers can
-- apply a change in one round trip. Additive; nothing dropped.
alter table entity_log add column if not exists payload jsonb;
