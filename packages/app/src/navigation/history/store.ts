import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { touchRecentVisit, type RecentVisit } from "./recent-workspaces";
import {
  EMPTY_HISTORY_STATE,
  pushEntry,
  replaceEntryAt,
  type HistoryEntry,
  type HistoryState,
} from "./model";

/**
 * In-memory history of visited locations, scoped to this app session like a browser window's
 * back/forward list. A closure store rather than zustand so the keyboard executor can read and
 * step it synchronously; same shape as the last-workspace selection store.
 */
export const RECENT_VISITS_STORAGE_KEY = "paseo:recent-visits";
const StoredVisitsSchema = z.array(
  z.object({
    serverId: z.string().min(1),
    workspaceId: z.string().min(1),
    agentId: z.string().min(1).nullable(),
    visitedAt: z.number().finite(),
  }),
);

export interface RecentVisitsPersistence {
  load: () => Promise<readonly RecentVisit[]>;
  save: (visits: readonly RecentVisit[]) => Promise<void>;
}

const defaultRecentVisitsPersistence: RecentVisitsPersistence = {
  load: async () => {
    const raw = await AsyncStorage.getItem(RECENT_VISITS_STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return StoredVisitsSchema.safeParse(parsed).data ?? [];
    } catch {
      return [];
    }
  },
  save: async (visits) => {
    await AsyncStorage.setItem(RECENT_VISITS_STORAGE_KEY, JSON.stringify(visits));
  },
};

export function createNavigationHistoryStore(persistence?: RecentVisitsPersistence) {
  let state: HistoryState = EMPTY_HISTORY_STATE;
  let recentVisits: readonly RecentVisit[] = [];
  let hydration: Promise<void> | null = null;
  let saveTask = Promise.resolve();
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) listener();
  }

  async function persistRecentVisits(next: readonly RecentVisit[]): Promise<void> {
    if (!persistence) return;
    await saveTask;
    await persistence.save(next);
  }

  function setRecentVisits(next: readonly RecentVisit[], shouldNotify = true) {
    if (next === recentVisits) return;
    recentVisits = next;
    if (shouldNotify) notify();
    if (persistence) {
      saveTask = persistRecentVisits(next).catch(() => undefined);
    }
  }

  function touchEntry(entry: HistoryEntry, shouldNotify: boolean) {
    if (entry.kind !== "workspace") return;
    const agentId = entry.target?.kind === "agent" ? entry.target.agentId : null;
    setRecentVisits(
      touchRecentVisit(recentVisits, {
        serverId: entry.serverId,
        workspaceId: entry.workspaceId,
        agentId,
        visitedAt: Date.now(),
      }),
      shouldNotify,
    );
  }

  function setState(next: HistoryState) {
    if (next === state) {
      return;
    }
    state = next;
    notify();
  }

  return {
    getState: () => state,
    getRecentVisits: () => recentVisits,
    hydrateRecentVisits: (): Promise<void> => {
      if (!persistence) return Promise.resolve();
      if (hydration) return hydration;
      hydration = persistence
        .load()
        .then((stored) => {
          let merged: readonly RecentVisit[] = stored;
          for (const visit of recentVisits.toReversed()) {
            merged = touchRecentVisit(merged, visit);
          }
          setRecentVisits(merged);
          return undefined;
        })
        .catch(() => undefined);
      return hydration;
    },
    record: (entry: HistoryEntry) => {
      const next = pushEntry(state, entry);
      if (next === state) return;
      touchEntry(entry, false);
      setState(next);
    },
    setIndex: (index: number) => {
      if (index < 0 || index >= state.entries.length || index === state.index) {
        return;
      }
      setState({ entries: state.entries, index });
    },
    replaceCurrent: (entry: HistoryEntry) => {
      const next = replaceEntryAt(state, state.index, entry);
      if (next === state) return;
      touchEntry(entry, false);
      setState(next);
    },
    reset: () => setState(EMPTY_HISTORY_STATE),
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type NavigationHistoryStore = ReturnType<typeof createNavigationHistoryStore>;

export const navigationHistoryStore = createNavigationHistoryStore(defaultRecentVisitsPersistence);
