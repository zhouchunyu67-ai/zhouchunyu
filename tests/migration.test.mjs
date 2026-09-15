import assert from "node:assert/strict";
import test from "node:test";

import { createEncryptedMigrationPackage, parseEncryptedMigrationPackage } from "../app/migration.ts";

function sampleRecord() {
  const now = Date.now();
  return {
    id: "migration-asset",
    file: new Blob([new Uint8Array([1, 2, 3, 255])], { type: "image/png" }),
    name: "sample.png",
    kind: "image",
    extension: "PNG",
    mime: "image/png",
    size: 4,
    status: "ready",
    prompt: "a sample image",
    category: "未分类",
    collection: "library",
    createdAt: now,
    updatedAt: now,
  };
}

test("round-trips encrypted migration packages with config and assets", async () => {
  const devVars = 'NEWBI_BASE_URL="https://api.new.bi"\nNEWBI_IMAGE_API_KEY="secret"\n';
  const created = await createEncryptedMigrationPackage(
    [sampleRecord()],
    { id: "workspace", favorites: ["p1"], recent: [], drafts: {}, assetCategories: ["未分类"], updatedAt: Date.now() },
    devVars,
    "correct horse battery staple",
  );
  assert.equal(created.assetCount, 1);
  const restored = await parseEncryptedMigrationPackage(created.blob, "correct horse battery staple");
  assert.equal(restored.devVars, devVars);
  assert.equal(restored.backup.assets.length, 1);
  assert.deepEqual(new Uint8Array(await restored.backup.assets[0].file.arrayBuffer()), new Uint8Array([1, 2, 3, 255]));
});

test("rejects an incorrect migration password and tampered package", async () => {
  const created = await createEncryptedMigrationPackage([sampleRecord()], null, "KEY=value\n", "password-123");
  await assert.rejects(parseEncryptedMigrationPackage(created.blob, "wrong-password"), /密码不正确/);
  const bytes = new Uint8Array(await created.blob.arrayBuffer());
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(parseEncryptedMigrationPackage(new Blob([bytes]), "password-123"), /密码不正确|文件已损坏/);
});

test("round-trips a backup spanning multiple encryption chunks", async () => {
  const bytes = new Uint8Array(16 * 1024 * 1024 + 123);
  bytes[0] = 7;
  bytes[bytes.length - 1] = 9;
  const source = sampleRecord();
  source.file = new Blob([bytes], { type: "image/png" });
  source.size = bytes.length;
  const created = await createEncryptedMigrationPackage([source], null, "KEY=value\n", "chunk-password");
  const restored = await parseEncryptedMigrationPackage(created.blob, "chunk-password");
  const restoredBytes = new Uint8Array(await restored.backup.assets[0].file.arrayBuffer());
  assert.equal(restoredBytes.length, bytes.length);
  assert.equal(restoredBytes[0], 7);
  assert.equal(restoredBytes[restoredBytes.length - 1], 9);
});
