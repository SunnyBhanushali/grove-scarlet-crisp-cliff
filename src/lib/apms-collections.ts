import "./apms-collections.js";

export type CollectionShape = "list" | "map" | "map2" | "scalar";

export type CollectionSpec = {
  field: string;
  kind: string;
  shape: CollectionShape;
  book: "org" | "plans" | "months" | "targets";
  keyFields?: string[];
  ordered?: boolean;
};

export type EntityRowShape = {
  kind: string;
  id: string;
  k1: string | null;
  k2: string | null;
  payload: Record<string, unknown>;
};

export type CollectionsApi = {
  SPECS: CollectionSpec[];
  SEP: string;
  FIELDS: string[];
  KINDS: string[];
  specForField(field: string): CollectionSpec | null;
  specForKind(kind: string): CollectionSpec | null;
  settingsSpec(field: string): CollectionSpec | null;
  rowKey(spec: CollectionSpec, row: unknown, fallbackIndex?: number): string | null;
  toRows(spec: CollectionSpec, value: unknown, skipped?: Array<{ field: string; index: number }>): EntityRowShape[];
  fromRows(spec: CollectionSpec, rows: EntityRowShape[]): unknown;
  applyRow(spec: CollectionSpec, current: unknown, row: EntityRowShape, deleted: boolean): unknown;
  rowPath(row: { kind: string; id: string; k1?: string | null; k2?: string | null }): string;
  wrap(value: unknown): Record<string, unknown>;
  unwrap(payload: unknown): unknown;
};

export const collections = (globalThis as unknown as { __apmsCollections: CollectionsApi }).__apmsCollections;

/** Fields whose authority is the generic entities table (not book PATCH). */
export const ENTITY_OWNED_FIELDS: ReadonlySet<string> = new Set(collections.FIELDS);

export function specForKindOrSettings(kind: string, id: string): CollectionSpec | null {
  if (kind === "settings") return collections.settingsSpec(id);
  return collections.specForKind(kind);
}
