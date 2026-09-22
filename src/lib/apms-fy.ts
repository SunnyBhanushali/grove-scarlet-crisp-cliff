/** Company calendar: April → March. Shared by Rewards already; APMS now uses the same year. */

export function fyStartYear(month: string, now = new Date()): number {
  const raw = String(month || "");
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(5, 7));
  if (Number.isFinite(y) && y > 0 && Number.isFinite(m) && m >= 1) {
    return m >= 4 ? y : y - 1;
  }
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return cm >= 4 ? cy : cy - 1;
}

/** Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. */
export function fyQuarter(month: string): 1 | 2 | 3 | 4 {
  const m = Number(String(month).slice(5, 7));
  if (m >= 10) return 3;
  if (m >= 7) return 2;
  if (m >= 4) return 1;
  return 4;
}

export function fyMonths(startYear: number): string[] {
  return [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map(
    (m) => `${m >= 4 ? startYear : startYear + 1}-${String(m).padStart(2, "0")}`,
  );
}

export const FY_QUARTER_LABELS = [
  "",
  "Q1 · Apr-Jun",
  "Q2 · Jul-Sep",
  "Q3 · Oct-Dec",
  "Q4 · Jan-Mar",
] as const;
