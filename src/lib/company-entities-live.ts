import type { BookId, Snapshot } from "./company-books";
import { applyEntityBookSlice, readLiveSnapshot } from "./company-notebook";
import type { EntityBooks } from "./company-entities";

// One adapter per process: caches keyed on it (the hydrate read) must hit.
let liveBooks: EntityBooks | null = null;
export function liveEntityBooks(): EntityBooks {
  if (!liveBooks) {
    liveBooks = {
      read: () => readLiveSnapshot(),
      applySlice: async (book: BookId, payload: Snapshot, extraTombs?: unknown) =>
        applyEntityBookSlice({ book, payload, extraTombs }),
    };
  }
  return liveBooks;
}
