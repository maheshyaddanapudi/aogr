/**
 * Persistence: match snapshots in IndexedDB (KICKOFF §2), settings in
 * localStorage (small + synchronous for boot-time reads).
 */
const DB = "aogr";
const STORE = "saves";
const KEY = "skirmish";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveGame(snapshot: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(snapshot, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadGame(): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export interface Settings {
  musicVol: number;
  sfxVol: number;
}

const SETTINGS_KEY = "aogr-settings";

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "");
    return { musicVol: s.musicVol ?? 0.35, sfxVol: s.sfxVol ?? 0.8 };
  } catch {
    return { musicVol: 0.35, sfxVol: 0.8 };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
