/**
 * PERF load runner — where a simulated save leaves its mark.
 *
 * Each save writes "user v12, save #7" into the row; the final check wants
 * every user's last acknowledged number still there. A person may only change
 * some fields of their own plan (batch 3: self comments), so APMS / Rewards
 * records carry the marks inside `selfNotes` (`LOAD{"v12":7,…}`), every other
 * row in a `loadMarks` object. A save re-applies its own mark on top of the
 * server's copy after a 409, exactly like a field-level merge.
 */
const PREFIX = "LOAD";

export function usesSelfNotes(table) {
  return table === "month" || table === "reward" || table === "month-records" || table === "reward-records";
}

export function marksOf(table, payload) {
  if (!payload || typeof payload !== "object") return {};
  if (usesSelfNotes(table)) {
    const s = String(payload.selfNotes || "");
    if (!s.startsWith(PREFIX)) return {};
    try {
      return JSON.parse(s.slice(PREFIX.length)) || {};
    } catch {
      return {};
    }
  }
  return payload.loadMarks && typeof payload.loadMarks === "object" ? payload.loadMarks : {};
}

export function withMark(table, payload, vu, n) {
  const marks = { ...marksOf(table, payload), [vu]: n };
  if (usesSelfNotes(table)) return { ...payload, selfNotes: PREFIX + JSON.stringify(marks) };
  return { ...payload, loadMarks: marks };
}
