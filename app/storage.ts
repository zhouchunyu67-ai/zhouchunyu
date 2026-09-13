export type StoredAssetRecord = {
  id: string;
  file: Blob;
  name: string;
  kind: "image" | "video";
  extension: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  status: "reading" | "ready" | "unsupported";
  prompt: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
};

export type StoredPromptState = {
  id: "workspace";
  favorites: string[];
  recent: string[];
  drafts: Record<string, string>;
  assetCategories?: string[];
  updatedAt: number;
};

const DATABASE_NAME = "frame-vault-local";
const DATABASE_VERSION = 2;
const STORE_NAME = "assets";
const PROMPT_STORE_NAME = "prompt-state";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(PROMPT_STORE_NAME)) {
        database.createObjectStore(PROMPT_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local database"));
  });
}

export async function loadStoredAssets(): Promise<StoredAssetRecord[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const records = await requestResult(transaction.objectStore(STORE_NAME).getAll());
  database.close();
  return records.sort((left, right) => right.createdAt - left.createdAt);
}

export async function saveStoredAsset(record: StoredAssetRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(record);
  await transactionDone(transaction);
  database.close();
}

export async function patchStoredAsset(
  id: string,
  values: Partial<Omit<StoredAssetRecord, "id" | "file" | "createdAt">>,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const current = await requestResult(store.get(id)) as StoredAssetRecord | undefined;
  if (current) store.put({ ...current, ...values, updatedAt: Date.now() });
  await transactionDone(transaction);
  database.close();
}

export async function deleteStoredAsset(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(id);
  await transactionDone(transaction);
  database.close();
}

export async function loadStoredPromptState(): Promise<StoredPromptState | null> {
  const database = await openDatabase();
  const transaction = database.transaction(PROMPT_STORE_NAME, "readonly");
  const record = await requestResult(transaction.objectStore(PROMPT_STORE_NAME).get("workspace")) as StoredPromptState | undefined;
  database.close();
  return record ?? null;
}

export async function saveStoredPromptState(
  values: Omit<StoredPromptState, "id" | "updatedAt">,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(PROMPT_STORE_NAME, "readwrite");
  transaction.objectStore(PROMPT_STORE_NAME).put({
    id: "workspace",
    ...values,
    updatedAt: Date.now(),
  } satisfies StoredPromptState);
  await transactionDone(transaction);
  database.close();
}
