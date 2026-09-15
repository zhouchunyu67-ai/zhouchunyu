import type { ParsedFrameVaultBackup } from "./backup.ts";
import { createFrameVaultBackup, parseFrameVaultBackup } from "./backup.ts";
import type { StoredAssetRecord, StoredPromptState } from "./storage.ts";

const MAGIC = "FRAMEVAULT-MIGRATION-V2\n";
const FORMAT = "frame-vault-migration";
const VERSION = 2;
const ITERATIONS = 310_000;
const GCM_TAG_BYTES = 16;
const BACKUP_CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_MIGRATION_BYTES = 1_500 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ParsedMigrationPackage = {
  backup: ParsedFrameVaultBackup;
  devVars: string;
  createdAt: string;
};

type Header = {
  format: typeof FORMAT;
  version: typeof VERSION;
  createdAt: string;
  iterations: number;
  salt: string;
  configIv: string;
  backupIv: string;
  configLength: number;
  backupLength: number;
  configCipherLength: number;
  backupCipherLength: number;
  backupChunkSize: number;
  backupChunkCount: number;
};

function base64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(value);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function keyFromPassword(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (password.length < 8) throw new Error("迁移密码至少需要 8 个字符。");
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function makeHeader(
  salt: Uint8Array,
  configIv: Uint8Array,
  backupIv: Uint8Array,
  configLength: number,
  backupLength: number,
): Header {
  const backupChunkCount = Math.max(1, Math.ceil(backupLength / BACKUP_CHUNK_SIZE));
  return {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    iterations: ITERATIONS,
    salt: base64(salt),
    configIv: base64(configIv),
    backupIv: base64(backupIv),
    configLength,
    backupLength,
    configCipherLength: configLength + GCM_TAG_BYTES,
    backupCipherLength: backupLength + backupChunkCount * GCM_TAG_BYTES,
    backupChunkSize: BACKUP_CHUNK_SIZE,
    backupChunkCount,
  };
}

export async function createEncryptedMigrationPackage(
  records: StoredAssetRecord[],
  promptState: StoredPromptState | null,
  devVars: string,
  password: string,
): Promise<{ blob: Blob; assetCount: number; totalBytes: number }> {
  const totalBytes = records.reduce((sum, record) => sum + record.file.size, 0);
  if (totalBytes > MAX_MIGRATION_BYTES) {
    throw new Error("素材总量超过 1.5 GB。为避免浏览器内存不足，请改用外部硬盘目录迁移，或分批导出普通素材备份。");
  }
  const backup = createFrameVaultBackup(records, promptState);
  const backupBytes = new Uint8Array(await backup.blob.arrayBuffer());
  const configBytes = encoder.encode(devVars);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const configIv = crypto.getRandomValues(new Uint8Array(12));
  const backupIv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromPassword(password, salt, ITERATIONS);
  const header = makeHeader(salt, configIv, backupIv, configBytes.length, backupBytes.length);
  const headerBytes = encoder.encode(JSON.stringify(header));
  // Encrypt the small config and the large backup independently. This avoids
  // allocating a second full-size plaintext buffer containing both payloads.
  const encryptedConfig = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: configIv, additionalData: headerBytes }, key, configBytes));
  const encryptedBackup: Uint8Array[] = [];
  for (let offset = 0; offset < backupBytes.length; offset += BACKUP_CHUNK_SIZE) {
    const chunkIndex = Math.floor(offset / BACKUP_CHUNK_SIZE);
    const chunkIv = new Uint8Array(backupIv);
    new DataView(chunkIv.buffer).setUint32(8, chunkIndex, false);
    const chunkData = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: chunkIv, additionalData: new Uint8Array([...headerBytes, ...u32(chunkIndex)]) },
      key,
      backupBytes.subarray(offset, Math.min(offset + BACKUP_CHUNK_SIZE, backupBytes.length)),
    );
    encryptedBackup.push(new Uint8Array(chunkData));
  }
  return {
    blob: new Blob([encoder.encode(MAGIC), u32(headerBytes.length), headerBytes, encryptedConfig, ...encryptedBackup], { type: "application/x-framevault-migration" }),
    assetCount: backup.manifest.assetCount,
    totalBytes: backup.manifest.totalBytes,
  };
}

export async function parseEncryptedMigrationPackage(file: Blob, password: string): Promise<ParsedMigrationPackage> {
  const magic = encoder.encode(MAGIC);
  const prefixSize = magic.length + 4;
  if (file.size < prefixSize) throw new Error("不是有效的 Frame Vault 加密迁移包。");
  const prefix = new Uint8Array(await file.slice(0, prefixSize).arrayBuffer());
  if (!magic.every((value, index) => prefix[index] === value)) throw new Error("不是有效的 Frame Vault 加密迁移包。");
  const headerLength = readU32(prefix, magic.length);
  const headerStart = prefixSize;
  const headerEnd = headerStart + headerLength;
  if (!headerLength || headerEnd > file.size) throw new Error("迁移包清单不完整。");
  let header: Header;
  try {
    header = JSON.parse(decoder.decode(await file.slice(headerStart, headerEnd).arrayBuffer())) as Header;
  } catch {
    throw new Error("迁移包清单无法读取。");
  }
  if (header.format !== FORMAT || header.version !== VERSION || header.iterations !== ITERATIONS
    || !Number.isSafeInteger(header.configLength) || header.configLength < 0
    || !Number.isSafeInteger(header.backupLength) || header.backupLength < 1
    || header.configCipherLength !== header.configLength + GCM_TAG_BYTES
    || header.backupChunkSize !== BACKUP_CHUNK_SIZE
    || header.backupChunkCount !== Math.max(1, Math.ceil(header.backupLength / BACKUP_CHUNK_SIZE))
    || header.backupCipherLength !== header.backupLength + header.backupChunkCount * GCM_TAG_BYTES) {
    throw new Error("迁移包版本不受支持。");
  }
  let salt: Uint8Array;
  let configIv: Uint8Array;
  let backupIv: Uint8Array;
  try {
    salt = fromBase64(header.salt);
    configIv = fromBase64(header.configIv);
    backupIv = fromBase64(header.backupIv);
  } catch {
    throw new Error("迁移包加密参数无效。");
  }
  if (salt.length !== 16 || configIv.length !== 12 || backupIv.length !== 12) throw new Error("迁移包加密参数无效。");
  const payloadStart = headerEnd;
  const configEnd = payloadStart + header.configCipherLength;
  const backupEnd = configEnd + header.backupCipherLength;
  if (backupEnd !== file.size) throw new Error("迁移包数据长度不一致。");
  const headerBytes = encoder.encode(JSON.stringify(header));
  const key = await keyFromPassword(password, salt, header.iterations);
  let configBytes: Uint8Array;
  const backupChunks: Uint8Array[] = [];
  try {
    configBytes = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: configIv, additionalData: headerBytes },
      key,
      await file.slice(payloadStart, configEnd).arrayBuffer(),
    ));
    let offset = configEnd;
    for (let chunkIndex = 0; chunkIndex < header.backupChunkCount; chunkIndex += 1) {
      const plainLength = Math.min(BACKUP_CHUNK_SIZE, header.backupLength - chunkIndex * BACKUP_CHUNK_SIZE);
      const cipherLength = plainLength + GCM_TAG_BYTES;
      const chunkIv = new Uint8Array(backupIv);
      new DataView(chunkIv.buffer).setUint32(8, chunkIndex, false);
      backupChunks.push(new Uint8Array(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: chunkIv, additionalData: new Uint8Array([...headerBytes, ...u32(chunkIndex)]) },
        key,
        await file.slice(offset, offset + cipherLength).arrayBuffer(),
      )));
      offset += cipherLength;
    }
  } catch {
    throw new Error("迁移密码不正确，或文件已损坏。");
  }
  if (configBytes.length !== header.configLength || backupChunks.reduce((sum, chunk) => sum + chunk.length, 0) !== header.backupLength) {
    throw new Error("迁移包数据长度不一致。");
  }
  const backupBlob = new Blob(backupChunks, { type: "application/x-framevault" });
  return { backup: await parseFrameVaultBackup(backupBlob), devVars: decoder.decode(configBytes), createdAt: header.createdAt };
}
