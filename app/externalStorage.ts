import type { StoredAssetRecord, StoredPromptState } from "./storage";

export type DirectoryPermissionState = "granted" | "denied" | "prompt";

export type VaultWritableFileStream = {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
};

export type VaultFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<VaultWritableFileStream>;
};

export type VaultDirectoryHandle = {
  kind: "directory";
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<VaultDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<VaultFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(options?: { mode?: "read" | "readwrite" }): Promise<DirectoryPermissionState>;
  requestPermission?(options?: { mode?: "read" | "readwrite" }): Promise<DirectoryPermissionState>;
};

export type ExternalVaultIndexAsset = Omit<StoredAssetRecord, "file"> & {
  path: string;
};

export type ExternalVaultIndex = {
  format: "frame-vault-directory";
  version: 1;
  updatedAt: number;
  assets: ExternalVaultIndexAsset[];
  promptState: StoredPromptState | null;
};

export type ExternalWorkspace = {
  records: StoredAssetRecord[];
  promptState: StoredPromptState | null;
  updatedAt: number;
};

export type ExternalSyncResult = {
  written: number;
  reused: number;
  removed: number;
  updatedAt: number;
};

const INDEX_FILE = "frame-vault-library.json";
const README_FILE = "README-请勿手动修改.txt";
const INDEX_FORMAT = "frame-vault-directory";
const INDEX_VERSION = 1;
const ASSET_KINDS = ["image", "video", "audio", "text", "link"] as const;

function externalError(message: string): Error {
  return new Error(`外部素材目录错误：${message}`);
}

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  return safe || "asset";
}

function safeExtension(value: string): string {
  const safe = value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return safe || "bin";
}

function assetPath(record: StoredAssetRecord): string {
  return `media/${record.kind}/${safeSegment(record.id)}.${safeExtension(record.extension)}`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "NotFoundError"
    : error instanceof Error && /not.?found/i.test(error.message);
}

async function getFileAtPath(root: VaultDirectoryHandle, path: string, create = false): Promise<VaultFileHandle> {
  const parts = path.split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) {
    throw externalError("素材路径无效");
  }
  let directory = root;
  for (const segment of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return directory.getFileHandle(parts.at(-1)!, { create });
}

async function writeFile(handle: VaultFileHandle, data: Blob | string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function readIndex(root: VaultDirectoryHandle): Promise<ExternalVaultIndex | null> {
  let handle: VaultFileHandle;
  try {
    handle = await root.getFileHandle(INDEX_FILE);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(await (await handle.getFile()).text());
  } catch {
    throw externalError("索引文件无法读取");
  }
  if (!value || typeof value !== "object") throw externalError("索引内容无效");
  const index = value as Partial<ExternalVaultIndex>;
  if (index.format !== INDEX_FORMAT || index.version !== INDEX_VERSION || !Array.isArray(index.assets)) {
    throw externalError("不是受支持的 Frame Vault 素材目录");
  }
  if (!Number.isFinite(index.updatedAt)) throw externalError("索引时间信息无效");
  const ids = new Set<string>();
  for (const asset of index.assets) {
    if (!asset || typeof asset !== "object") throw externalError("素材索引损坏");
    if (typeof asset.id !== "string" || !asset.id || ids.has(asset.id)) throw externalError("素材编号重复或缺失");
    if (typeof asset.path !== "string" || !asset.path.startsWith("media/") || asset.path.includes("..")) throw externalError("素材路径无效");
    if (!ASSET_KINDS.includes(asset.kind)) throw externalError("素材类型无效");
    if (typeof asset.name !== "string" || typeof asset.extension !== "string" || typeof asset.mime !== "string") throw externalError("素材信息不完整");
    if (asset.kind === "link" && (typeof asset.linkUrl !== "string" || !asset.linkUrl)) throw externalError("链接地址缺失");
    if (!Number.isSafeInteger(asset.size) || asset.size < 0) throw externalError("素材大小无效");
    ids.add(asset.id);
  }
  return index as ExternalVaultIndex;
}

async function removePath(root: VaultDirectoryHandle, path: string): Promise<boolean> {
  const parts = path.split("/");
  if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) return false;
  try {
    let directory = root;
    for (const segment of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment);
    }
    await directory.removeEntry(parts.at(-1)!);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export function supportsExternalDirectories(scope: Window = window): boolean {
  return "showDirectoryPicker" in scope;
}

export async function verifyExternalDirectoryPermission(
  handle: VaultDirectoryHandle,
  request: boolean,
): Promise<boolean> {
  const options = { mode: "readwrite" as const };
  if (handle.queryPermission && await handle.queryPermission(options) === "granted") return true;
  if (request && handle.requestPermission && await handle.requestPermission(options) === "granted") return true;
  return false;
}

export async function chooseExternalDirectory(): Promise<VaultDirectoryHandle> {
  if (!supportsExternalDirectories()) throw externalError("当前浏览器不支持选择本地文件夹，请使用最新版 Chrome 或 Edge");
  const picker = (window as unknown as Window & {
    showDirectoryPicker(options: { id: string; mode: "readwrite" }): Promise<VaultDirectoryHandle>;
  }).showDirectoryPicker;
  return picker.call(window, { id: "frame-vault-library", mode: "readwrite" });
}

export async function readExternalWorkspace(root: VaultDirectoryHandle): Promise<ExternalWorkspace | null> {
  const index = await readIndex(root);
  if (!index) return null;
  const records: StoredAssetRecord[] = [];
  for (const asset of index.assets) {
    let file: File;
    try {
      file = await (await getFileAtPath(root, asset.path)).getFile();
    } catch (error) {
      if (isNotFound(error)) throw externalError(`找不到素材“${asset.name}”的源文件`);
      throw error;
    }
    if (file.size !== asset.size) throw externalError(`素材“${asset.name}”大小与索引不一致`);
    const storedFile = file.name === asset.name
      ? file
      : new File([file], asset.name, { type: asset.mime || file.type, lastModified: file.lastModified });
    records.push({ ...asset, file: storedFile });
  }
  return { records, promptState: index.promptState ?? null, updatedAt: index.updatedAt };
}

export async function syncExternalWorkspace(
  root: VaultDirectoryHandle,
  records: StoredAssetRecord[],
  promptState: StoredPromptState | null,
): Promise<ExternalSyncResult> {
  const previous = await readIndex(root);
  const previousById = new Map(previous?.assets.map((asset) => [asset.id, asset]) ?? []);
  const nextAssets: ExternalVaultIndexAsset[] = [];
  let written = 0;
  let reused = 0;

  for (const kind of ASSET_KINDS) {
    const media = await root.getDirectoryHandle("media", { create: true });
    await media.getDirectoryHandle(kind, { create: true });
  }

  for (const record of records) {
    const path = assetPath(record);
    const previousAsset = previousById.get(record.id);
    const payload = record.kind === "text"
      ? new Blob([record.textContent ?? ""], { type: record.mime || "text/plain;charset=utf-8" })
      : record.kind === "link"
        ? new Blob([`[InternetShortcut]\r\nURL=${record.linkUrl ?? ""}\r\n`], { type: record.mime || "text/uri-list" })
        : record.file;
    const normalizedSize = payload.size;
    let shouldWrite = record.kind === "text" || record.kind === "link" || previousAsset?.path !== path || previousAsset?.size !== normalizedSize;
    if (!shouldWrite) {
      try {
        const existing = await (await getFileAtPath(root, path)).getFile();
        shouldWrite = existing.size !== normalizedSize;
      } catch (error) {
        if (isNotFound(error)) shouldWrite = true;
        else throw error;
      }
    }
    if (shouldWrite) {
      const handle = await getFileAtPath(root, path, true);
      await writeFile(handle, payload);
      const verified = await handle.getFile();
      if (verified.size !== normalizedSize) throw externalError(`素材“${record.name}”写入校验失败`);
      written += 1;
    } else {
      reused += 1;
    }
    const { file, ...metadata } = record;
    void file;
    nextAssets.push({ ...metadata, size: normalizedSize, path, updatedAt: Date.now() });
  }

  const index: ExternalVaultIndex = {
    format: INDEX_FORMAT,
    version: INDEX_VERSION,
    updatedAt: Date.now(),
    assets: nextAssets,
    promptState,
  };
  await writeFile(await root.getFileHandle(INDEX_FILE, { create: true }), JSON.stringify(index, null, 2));

  let removed = 0;
  const nextPaths = new Set(nextAssets.map((asset) => asset.path));
  for (const asset of previous?.assets ?? []) {
    if (!nextPaths.has(asset.path) && await removePath(root, asset.path)) removed += 1;
  }

  try {
    await root.getFileHandle(README_FILE);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const help = [
      "这是 Frame Vault 外部素材目录。",
      "media 文件夹保存源素材与链接快捷方式，frame-vault-library.json 保存名称、类目、链接描述和提示词等索引。",
      "请优先在 Frame Vault 中修改或删除素材，不要手动编辑索引文件。",
      "移动硬盘或 U 盘写入过程中请勿拔出。",
    ].join("\r\n");
    await writeFile(await root.getFileHandle(README_FILE, { create: true }), help);
  }

  return { written, reused, removed, updatedAt: index.updatedAt };
}
