// The storage seam — the app injects it, this package never imports a
// platform API directly. Synchronous on purpose (localStorage and MMKV both are).
//
//   web: createAuthStores({ ..., storage: localStorage })
//   RN:  { getItem: (k) => mmkv.getString(k) ?? null,
//          setItem: (k, v) => mmkv.set(k, v),
//          removeItem: (k) => mmkv.delete(k) }

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

/** In-memory fallback — SSR and test isolation. */
export function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}
