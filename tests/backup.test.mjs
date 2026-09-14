import assert from "node:assert/strict";
import test from "node:test";

import {
  createFrameVaultBackup,
  parseFrameVaultBackup,
} from "../app/backup.ts";

function record(overrides) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    file: new Blob(["sample"], { type: "application/octet-stream" }),
    name: "sample.bin",
    kind: "text",
    extension: "TXT",
    mime: "text/plain",
    size: 6,
    textContent: "sample",
    status: "ready",
    prompt: "测试提示词",
    category: "未分类",
    collection: "library",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("round-trips original asset bytes and workspace metadata through a framevault file", async () => {
  const records = [
    record({ id: "text-1", file: new Blob(["第一段文本"], { type: "text/plain" }), name: "文本.txt", size: 15 }),
    record({ id: "video-1", file: new Blob([new Uint8Array([0, 1, 2, 3, 255])], { type: "video/mp4" }), name: "片段.mp4", kind: "video", extension: "MP4", mime: "video/mp4", size: 5, textContent: undefined, category: "白膜视频", collection: "category" }),
    record({ id: "link-1", file: new Blob(["[InternetShortcut]\r\nURL=https://example.com/\r\n"], { type: "text/uri-list" }), name: "项目主页", kind: "link", extension: "LINK", mime: "text/uri-list", size: 51, textContent: "项目参考入口", linkUrl: "https://example.com/" }),
  ];
  const promptState = {
    id: "workspace",
    favorites: ["favorite-1"],
    recent: ["recent-1"],
    drafts: { "draft-1": "本地草稿" },
    assetCategories: ["未分类", "白膜视频"],
    updatedAt: Date.now(),
  };

  const { blob, manifest } = createFrameVaultBackup(records, promptState);
  const restored = await parseFrameVaultBackup(blob);

  assert.equal(manifest.assetCount, 3);
  assert.equal(restored.assets.length, 3);
  assert.equal(await restored.assets[0].file.text(), "第一段文本");
  assert.deepEqual(new Uint8Array(await restored.assets[1].file.arrayBuffer()), new Uint8Array([0, 1, 2, 3, 255]));
  assert.equal(restored.assets[1].category, "白膜视频");
  assert.equal(restored.assets[2].linkUrl, "https://example.com/");
  assert.equal(restored.assets[2].textContent, "项目参考入口");
  assert.deepEqual(restored.promptState?.assetCategories, ["未分类", "白膜视频"]);
  assert.equal(restored.promptState?.drafts["draft-1"], "本地草稿");
});

test("rejects files that are not framevault backups", async () => {
  await assert.rejects(
    parseFrameVaultBackup(new Blob(["not-a-backup"])),
    /备份文件无效/,
  );
});
