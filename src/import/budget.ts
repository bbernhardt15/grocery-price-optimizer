/** In-memory daily caps for calls that spend a model key. One process, UTC day. */

type Bucket = { day: string; count: number };

export type Budget = {
  take(key: string, userLimit: number, globalCap: number): { ok: true } | { ok: false; scope: "user" | "global" };
  reset(): void;
};

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function createImportBudget(now: () => number = () => Date.now()): Budget {
  const users = new Map<string, Bucket>();
  let global: Bucket = { day: "", count: 0 };

  return {
    take(key, userLimit, globalCap) {
      const day = dayKey(now());
      if (global.day !== day) global = { day, count: 0 };
      const user = users.get(key);
      const mine = user && user.day === day ? user : { day, count: 0 };
      if (globalCap > 0 && global.count >= globalCap) return { ok: false, scope: "global" };
      if (userLimit > 0 && mine.count >= userLimit) {
        users.set(key, mine);
        return { ok: false, scope: "user" };
      }
      mine.count += 1;
      global.count += 1;
      users.set(key, mine);
      return { ok: true };
    },
    reset() {
      users.clear();
      global = { day: "", count: 0 };
    },
  };
}

export const importBudget = createImportBudget();
