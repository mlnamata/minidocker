import { clear, createStore, del, get, set, type UseStore } from 'idb-keyval';

let store: UseStore | null = null;
/** Po „Reset“ už nic neukládáme (běžící procesy by jinak stihly zapsat stav zpět). */
let frozen = false;
function db(): UseStore {
  if (!store) store = createStore('minidocker', 'kv');
  return store;
}

export const KEYS = {
  project: 'project',
  images: 'images',
  containers: 'containers',
  layers: 'layers',
  history: 'history',
  snapshot: (layerId: string) => `snap:${layerId}`,
};

export async function load<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(key, db());
  } catch (e) {
    console.warn('[storage] načtení selhalo', key, e);
    return undefined;
  }
}

export async function save(key: string, value: unknown): Promise<void> {
  if (frozen) return;
  try {
    await set(key, value, db());
  } catch (e) {
    console.warn('[storage] uložení selhalo', key, e);
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await del(key, db());
  } catch {
    /* ignore */
  }
}

export async function clearAll(): Promise<void> {
  frozen = true;
  await clear(db());
}

/** Odložené ukládání – při rychlých změnách (psaní v editoru) zapíše jen poslední stav. */
export function debounced(key: string, delay = 400): (value: unknown) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: unknown;
  return (value: unknown) => {
    pending = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void save(key, pending);
    }, delay);
  };
}
