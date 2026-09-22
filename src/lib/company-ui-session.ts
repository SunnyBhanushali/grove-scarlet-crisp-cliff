import type { Snapshot } from "./company-books";

/** Client navigation — never persist in the shared company document. */
export const UI_SESSION_KEYS = [
  "currentMonth",
  "view",
  "kind",
  "selectedPersonId",
  "selectedMonth",
  "selectedRoleId",
  "selectedTargetMonth",
  "selectedApmsId",
  "selectedAwardId",
  "selectedFunctionId",
  "selectedSbuId",
  "selectedBrandId",
  "selectedAgsId",
  "selectedPeriodId",
  "selectedRoleCaseId",
  "navHistory",
  "orgFilterBrandId",
] as const;

export type UiSessionKey = (typeof UI_SESSION_KEYS)[number];

export function stripUiSessionKeys<T extends Record<string, unknown>>(
  snapshot: T,
): T {
  const next = { ...snapshot };
  for (const key of UI_SESSION_KEYS) delete next[key];
  return next;
}

export function hasUiSessionKeys(snapshot: Record<string, unknown> | null | undefined): boolean {
  if (!snapshot) return false;
  return UI_SESSION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(snapshot, key));
}

export function stripSnapshotUiSession(snapshot: Snapshot): Snapshot {
  return stripUiSessionKeys(snapshot);
}
