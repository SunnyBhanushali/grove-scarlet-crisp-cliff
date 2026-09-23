/**
 * Test database for the ROWS-V2 suites.
 *   1. PGlite when the package is installed (normal `npm test`)
 *   2. a real Postgres over scripts/mini-pg.mjs when PGTEST=1 or PGPORT is set
 *   3. otherwise the suite is skipped with a note
 */
import { readFileSync } from "node:fs";
import type { HotSql } from "./company-hot-tables.ts";

const hotMigration = readFileSync(new URL("../../migrations/0005_hot_tables.sql", import.meta.url), "utf8");
const entityMigration =
  readFileSync(new URL("../../migrations/0008_entities.sql", import.meta.url), "utf8") +
  "\n" +
  readFileSync(new URL("../../migrations/0009_entity_log_payload.sql", import.meta.url), "utf8");

export type TestDb = { sql: HotSql; close(): void };

export async function openTestDb(): Promise<TestDb | null> {
  const wantReal = process.env.PGTEST === "1" || !!process.env.PGPORT;
  if (!wantReal) {
    try {
      const { PGlite } = (await import("@electric-sql/pglite")) as unknown as { PGlite: new () => { waitReady: Promise<void>; exec(s: string): Promise<void>; query<T>(t: string, p?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void> } };
      const pg = new PGlite();
      await pg.waitReady;
      await pg.exec(hotMigration);
      await pg.exec(entityMigration);
      return {
        sql: {
          query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
        },
        close: () => void pg.close(),
      };
    } catch {
      /* fall through to a real server */
    }
  }
  try {
    const { connect, testDbConfig } = await import("../../scripts/mini-pg.mjs");
    const db = await connect(testDbConfig());
    await db.exec("drop table if exists entities; drop table if exists entity_log; drop table if exists write_ids; drop table if exists people; drop table if exists month_records; drop table if exists reward_records; drop table if exists target_cells; drop table if exists tombstones;");
    await db.exec(hotMigration);
    await db.exec(entityMigration);
    return {
      sql: {
        query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.query(text, params)) as T[],
      },
      close: () => db.end(),
    };
  } catch {
    return null;
  }
}
