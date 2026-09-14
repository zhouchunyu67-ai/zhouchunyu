import type { StoredAssetRecord, StoredPromptState } from "./storage";

const BACKUP_MAGIC = "FRAMEVAULT-BACKUP-V1\n";
const BACKUP_FORMAT = "frame-vault-backup";
const BACKUP_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const magicBytes = encoder.encode(BACKUP_MAGIC);

type BackupAssetEntry = Omit<StoredAssetRecord, "file"> & {
  payloadSize: number;
};

export type FrameVaultBackupManifest = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  assetCount: number;
  totalBytes: number;
  promptState: StoredPromptState | null;
  assets: BackupAssetEntry[];
};

export type ParsedFrameVaultBackup = {
  manifest: FrameVaultBackupManifest;
  assets: StoredAssetRecord[];
  promptState: StoredPromptState | null;
};

function backupError(message: string): Error {
  return new Error(`备份文件无效：${message}`);
}

function isAssetKind(value: unknown): value is StoredAssetRecord["kind"] {
  return value === "image" || value === "video" || value === "audio" || value === "text" || value === "link";
}

function isAssetStatus(value: unknown): value is StoredAssetRecord["status"] {
  return value === "reading" || value === "ready" || value === "unsupported";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validatePromptState(value: unknown): asserts value is StoredPromptState | null {
  if (value === null || value === undefined) return;
  if (!value || typeof value !== "object") throw backupError("工作区记录损坏");
  const state = value as Partial<StoredPromptState>;
  if (state.id !== "workspace" || !isStringArray(state.favorites) || !isStringArray(state.recent)) {
    throw backupError("提示词记录损坏");
  }
  if (!state.drafts || typeof state.drafts !== "object" || Array.isArray(state.drafts)
    || !Object.values(state.drafts).every((draft) => typeof draft === "string")) {
    throw backupError("提示词草稿损坏");
  }
  if (state.assetCategories !== undefined && !isStringArray(state.assetCategories)) {
    throw backupError("类目记录损坏");
  }
  if (!Number.isFinite(state.updatedAt)) throw backupError("工作区时间信息异常");
}

function validateManifest(value: unknown): asserts value is FrameVaultBackupManifest {
  if (!value || typeof value !== "object") throw backupError("缺少清单");
  const manifest = value as Partial<FrameVaultBackupManifest>;
  if (manifest.format !== BACKUP_FORMAT) throw backupError("不是 Frame Vault 素材包");
  if (manifest.version !== BACKUP_VERSION) throw backupError("版本暂不支持");
  if (!Array.isArray(manifest.assets)) throw backupError("素材清单损坏");
  if (manifest.assetCount !== manifest.assets.length) throw backupError("素材数量不一致");
  if (!Number.isSafeInteger(manifest.totalBytes) || (manifest.totalBytes ?? -1) < 0) throw backupError("素材总大小异常");
  validatePromptState(manifest.promptState);

  const ids = new Set<string>();
  manifest.assets.forEach((asset) => {
    if (!asset || typeof asset !== "object") throw backupError("素材记录损坏");
    if (typeof asset.id !== "string" || !asset.id || ids.has(asset.id)) throw backupError("素材标识重复或缺失");
    if (typeof asset.name !== "string" || !asset.name) throw backupError("素材名称缺失");
    if (!isAssetKind(asset.kind) || !isAssetStatus(asset.status)) throw backupError("素材类型异常");
    if (typeof asset.extension !== "string" || typeof asset.mime !== "string") throw backupError("素材格式异常");
    if (!Number.isSafeInteger(asset.payloadSize) || asset.payloadSize < 0) throw backupError("素材文件大小异常");
    if (!Number.isSafeInteger(asset.size) || asset.size < 0) throw backupError("素材大小记录异常");
    if (typeof asset.prompt !== "string" || (asset.textContent !== undefined && typeof asset.textContent !== "string")) throw backupError("素材文本记录异常");
    if (asset.kind === "link" && (typeof asset.linkUrl !== "string" || !asset.linkUrl)) throw backupError("链接地址缺失");
    if (asset.category !== undefined && typeof asset.category !== "string") throw backupError("素材类目异常");
    if (asset.collection !== undefined && asset.collection !== "library" && asset.collection !== "category") throw backupError("素材位置异常");
    if (!Number.isFinite(asset.createdAt) || !Number.isFinite(asset.updatedAt)) throw backupError("素材时间信息异常");
    ids.add(asset.id);
  });
}

export function createFrameVaultBackup(
  records: StoredAssetRecord[],
  promptState: StoredPromptState | null,
): { blob: Blob; manifest: FrameVaultBackupManifest } {
  const assets: BackupAssetEntry[] = records.map(({ file, ...record }) => ({
    ...record,
    payloadSize: file.size,
  }));
  const totalBytes = assets.reduce((sum, asset) => sum + asset.payloadSize, 0);
  const manifest: FrameVaultBackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    assetCount: assets.length,
    totalBytes,
    promptState,
    assets,
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("素材索引过大，无法生成备份");
  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, manifestBytes.byteLength, true);
  const payloads = records.map((record) => record.file);
  return {
    blob: new Blob([magicBytes, lengthBytes, manifestBytes, ...payloads], { type: "application/x-framevault" }),
    manifest,
  };
}

export async function parseFrameVaultBackup(file: Blob): Promise<ParsedFrameVaultBackup> {
  const prefixSize = magicBytes.byteLength + 4;
  if (file.size < prefixSize) throw backupError("文件不完整");
  const prefix = new Uint8Array(await file.slice(0, prefixSize).arrayBuffer());
  for (let index = 0; index < magicBytes.byteLength; index += 1) {
    if (prefix[index] !== magicBytes[index]) throw backupError("文件头不匹配");
  }
  const manifestLength = new DataView(prefix.buffer, prefix.byteOffset + magicBytes.byteLength, 4).getUint32(0, true);
  if (!manifestLength || manifestLength > MAX_MANIFEST_BYTES) throw backupError("清单大小异常");
  const payloadStart = prefixSize + manifestLength;
  if (payloadStart > file.size) throw backupError("清单不完整");

  let manifestValue: unknown;
  try {
    const bytes = new Uint8Array(await file.slice(prefixSize, payloadStart).arrayBuffer());
    manifestValue = JSON.parse(decoder.decode(bytes));
  } catch {
    throw backupError("清单无法读取");
  }
  validateManifest(manifestValue);

  let cursor = payloadStart;
  const records: StoredAssetRecord[] = manifestValue.assets.map(({ payloadSize, ...record }) => {
    const end = cursor + payloadSize;
    if (!Number.isSafeInteger(end) || end > file.size) throw backupError(`素材“${record.name}”的数据不完整`);
    const payload = file.slice(cursor, end, record.mime || "application/octet-stream");
    cursor = end;
    return { ...record, file: payload };
  });
  if (cursor !== file.size || manifestValue.totalBytes !== file.size - payloadStart) {
    throw backupError("文件大小与清单不一致");
  }

  return {
    manifest: manifestValue,
    assets: records,
    promptState: manifestValue.promptState ?? null,
  };
}
