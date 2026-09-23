import type { ScoreDocument, StoredProgress } from "../types";

const DB_NAME = "atelier-piano";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("scores")) {
        database.createObjectStore("scores", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("progress")) {
        database.createObjectStore("progress", { keyPath: "scoreId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(storeName: "scores" | "progress", mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const request = run(database.transaction(storeName, mode).objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

export const scoreStorage = {
  list: () => transaction<ScoreDocument[]>("scores", "readonly", (store) => store.getAll()),
  put: (score: ScoreDocument) => transaction<IDBValidKey>("scores", "readwrite", (store) => store.put(score)),
  remove: (id: string) => transaction<undefined>("scores", "readwrite", (store) => store.delete(id) as IDBRequest<undefined>),
  getProgress: (scoreId: string) => transaction<StoredProgress | undefined>("progress", "readonly", (store) => store.get(scoreId)),
  listProgress: () => transaction<StoredProgress[]>("progress", "readonly", (store) => store.getAll()),
  putProgress: (progress: StoredProgress) => transaction<IDBValidKey>("progress", "readwrite", (store) => store.put(progress)),
  removeProgress: (scoreId: string) => transaction<undefined>("progress", "readwrite", (store) => store.delete(scoreId) as IDBRequest<undefined>),
};
