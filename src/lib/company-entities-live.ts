import type { BookId, Snapshot } from "./company-books";
import { applyEntityBookSlice, readLiveSnapshot } from "./company-notebook";
import type { EntityBooks } from "./company-entities";

export function liveEntityBooks(): EntityBooks {
  return {
    read: () => readLiveSnapshot(),
    applySlice: async (book: BookId, payload: Snapshot, extraTombs?: unknown) =>
      applyEntityBookSlice({ book, payload, extraTombs }),
  };
}
