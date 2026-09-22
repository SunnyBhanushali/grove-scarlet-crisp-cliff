/** Client-only People list chrome. Never written to company books / DB. */

export type PeopleListUi = {
  q?: string;
  brands?: string[];
  sbus?: string[];
  functionId?: string;
  roleId?: string;
  status?: string;
  monthStatus?: string;
  sort?: string;
  mode?: string;
  /** People filter card open. Unset → admin/super_admin open; everyone else collapsed. */
  filtersOpen?: boolean;
};

const KEY = "apms-ui-people-list-v1";

let mem: PeopleListUi | null = null;

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function loadPeopleListUi(): PeopleListUi {
  if (mem) return { ...mem };
  const store = storage();
  if (store) {
    try {
      const raw = store.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PeopleListUi;
        if (parsed && typeof parsed === "object") mem = parsed;
      }
    } catch {
      /* ignore */
    }
  }
  return { ...(mem || {}) };
}

export function savePeopleListUi(partial: PeopleListUi): PeopleListUi {
  mem = { ...loadPeopleListUi(), ...partial };
  const store = storage();
  if (store) {
    try {
      store.setItem(KEY, JSON.stringify(mem));
    } catch {
      /* quota / private mode */
    }
  }
  return { ...mem };
}

export function peopleFiltersStartOpen(
  person: { access?: string } | null | undefined,
  saved?: boolean,
): boolean {
  if (typeof saved === "boolean") return saved;
  const a = person?.access;
  return a === "admin" || a === "super_admin";
}

export function resetPeopleListUiForTests(): void {
  mem = null;
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Screen location — never in DB / company persist. */
export const SESSION_KEYS = [
  "view",
  "kind",
  "currentMonth",
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
  "peopleListFilter",
  "listFilter",
  "roleListFilter",
] as const;

const SESSION_KEY = "apms-ui-session-v1";
let sessionMem: Record<string, unknown> | null = null;
/** Frozen at first read this page-load so persist hydrate cannot poison it. */
let bootSession: Record<string, unknown> | null = null;

export function pickSession(state: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!state) return out;
  for (const key of SESSION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(state, key) && state[key] !== undefined) {
      out[key] = state[key];
    }
  }
  return out;
}

export function loadSession(): Record<string, unknown> {
  if (!sessionMem) {
    const store = storage();
    if (store) {
      try {
        const raw = store.getItem(SESSION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") sessionMem = pickSession(parsed);
        }
      } catch {
        /* ignore */
      }
    }
  }
  freezeBoot(sessionMem);
  return { ...(sessionMem || {}) };
}

export function saveSession(state: Record<string, unknown>): Record<string, unknown> {
  sessionMem = pickSession({ ...loadSession(), ...state });
  freezeBoot(sessionMem);
  const store = storage();
  if (store) {
    try {
      store.setItem(SESSION_KEY, JSON.stringify(sessionMem));
    } catch {
      /* ignore */
    }
  }
  return { ...sessionMem };
}

/**
 * Overlay the page-load screen location onto company persist / GET state.
 * Persisted localStorage often still has view:"home"; that must not win.
 */
export function applySession<T extends Record<string, unknown>>(state: T | null | undefined): T {
  const ui = bootSession || loadSession();
  return { ...(state || ({} as T)), ...ui } as T;
}

export function resetSessionForTests(): void {
  sessionMem = null;
  bootSession = null;
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function freezeBoot(ui: Record<string, unknown> | null): void {
  if (bootSession || !ui || Object.keys(ui).length === 0) return;
  bootSession = { ...ui };
}

