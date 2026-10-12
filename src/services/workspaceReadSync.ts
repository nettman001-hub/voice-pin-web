/** Event-driven reads shared by the commerce and sales providers. */
export interface WorkspaceReadSync<T> {
  request: (tables?: readonly string[], revalidateAfterFlight?: boolean) => Promise<boolean>;
  isReading: (table: string) => boolean;
  dispose: () => void;
}

export function createWorkspaceReadSync<T>(options: {
  tables: readonly string[];
  load: (tables: string[]) => Promise<T>;
  apply: (value: T) => void;
  available: () => boolean;
  success?: () => void;
  failure?: (error: unknown) => void;
}): WorkspaceReadSync<T> {
  let disposed = false;
  let inFlight: Promise<boolean> | null = null;
  let activeTables: string[] = [];
  const pending = new Set<string>();
  const request = (tables = options.tables, revalidateAfterFlight = false): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    for (const table of tables) if (options.tables.includes(table)
      && (revalidateAfterFlight || !activeTables.includes(table))) pending.add(table);
    if (inFlight) return inFlight;
    if (!options.available()) return Promise.resolve(false);
    inFlight = (async () => {
      let succeeded = true;
      while (!disposed && pending.size && options.available()) {
        const next = [...pending];
        pending.clear();
        activeTables = next;
        try {
          const value = await options.load(next);
          if (disposed) return false;
          options.apply(value);
          options.success?.();
        } catch (error) {
          succeeded = false;
          // Retain invalidation for the next reconnect/focus/fallback attempt,
          // without immediately retrying a failed request in a tight loop.
          next.forEach((table) => pending.add(table));
          if (!disposed) options.failure?.(error);
          break;
        }
      }
      return succeeded;
    })().finally(() => { inFlight = null; activeTables = []; });
    return inFlight;
  };
  return { request, isReading: (table) => !disposed && activeTables.includes(table), dispose() { disposed = true; pending.clear(); } };
}

export const workspaceReadsAvailable = () => (
  (typeof navigator === 'undefined' || navigator.onLine !== false)
  && (typeof document === 'undefined' || document.visibilityState !== 'hidden')
);
