import assert from "node:assert/strict";
import test from "node:test";

import {
  readExternalWorkspace,
  syncExternalWorkspace,
  verifyExternalDirectoryPermission,
} from "../app/externalStorage.ts";

class MemoryFileHandle {
  kind = "file";

  constructor(name) {
    this.name = name;
    this.data = new Uint8Array();
    this.type = "";
  }

  async getFile() {
    return new File([this.data], this.name, { type: this.type });
  }

  async createWritable() {
    return {
      write: async (value) => {
        const blob = typeof value === "string" ? new Blob([value], { type: "text/plain" }) : value;
        this.data = new Uint8Array(await blob.arrayBuffer());
        this.type = blob.type;
      },
      close: async () => {},
    };
  }
}

class MemoryDirectoryHandle {
  kind = "directory";

  constructor(name) {
    this.name = name;
    this.directories = new Map();
    this.files = new Map();
    this.permission = "granted";
  }

  async getDirectoryHandle(name, options = {}) {
    if (!this.directories.has(name)) {
      if (!options.create) throw new DOMException("Missing", "NotFoundError");
      this.directories.set(name, new MemoryDirectoryHandle(name));
    }
    return this.directories.get(name);
  }

  async getFileHandle(name, options = {}) {
    if (!this.files.has(name)) {
      if (!options.create) throw new DOMException("Missing", "NotFoundError");
      this.files.set(name, new MemoryFileHandle(name));
    }
    return this.files.get(name);
  }

  async removeEntry(name) {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException("Missing", "NotFoundError");
    }
  }

  async queryPermission() {
    return this.permission;
  }

  async requestPermission() {
    this.permission = "granted";
    return this.permission;
  }
}

function record(overrides) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    file: new File(["素材"], "素材.txt", { type: "text/plain" }),
    name: "素材.txt",
    kind: "text",
    extension: "TXT",
    mime: "text/plain",
    size: new Blob(["素材"]).size,
    textContent: "素材",
    status: "ready",
    prompt: "",
    category: "未分类",
    collection: "category",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("writes, verifies and reads a portable external material directory", async () => {
  const root = new MemoryDirectoryHandle("FrameVault素材库");
  const text = record({ id: "text-1", textContent: "第一版文本", size: new Blob(["第一版文本"]).size });
  const videoBytes = new Uint8Array([0, 1, 2, 3, 255]);
  const video = record({
    id: "video-1",
    file: new File([videoBytes], "镜头.mp4", { type: "video/mp4" }),
    name: "镜头.mp4",
    kind: "video",
    extension: "MP4",
    mime: "video/mp4",
    size: videoBytes.length,
    textContent: undefined,
    prompt: "缓慢推进",
    category: "空镜素材",
  });
  const promptState = {
    id: "workspace",
    favorites: [],
    recent: [],
    drafts: {},
    assetCategories: ["未分类", "空镜素材"],
    updatedAt: Date.now(),
  };
  const linkUrl = "https://example.com/reference";
  const link = record({
    id: "link-1",
    file: new File([`[InternetShortcut]\r\nURL=${linkUrl}\r\n`], "参考链接.url", { type: "text/uri-list" }),
    name: "参考链接",
    kind: "link",
    extension: "LINK",
    mime: "text/uri-list",
    textContent: "用于项目资料检索",
    linkUrl,
  });

  const result = await syncExternalWorkspace(root, [text, video, link], promptState);
  assert.equal(result.written, 3);
  const restored = await readExternalWorkspace(root);
  assert.equal(restored.records.length, 3);
  assert.equal(restored.records[0].textContent, "第一版文本");
  assert.deepEqual(new Uint8Array(await restored.records[1].file.arrayBuffer()), videoBytes);
  assert.equal(restored.records[1].category, "空镜素材");
  assert.equal(restored.records[2].linkUrl, linkUrl);
  assert.equal(restored.records[2].textContent, "用于项目资料检索");
  assert.deepEqual(restored.promptState.assetCategories, ["未分类", "空镜素材"]);
});

test("updates text and removes deleted managed files on the next sync", async () => {
  const root = new MemoryDirectoryHandle("U盘素材库");
  const text = record({ id: "text-1", textContent: "旧内容", size: new Blob(["旧内容"]).size });
  const video = record({ id: "video-1", kind: "video", extension: "MP4", mime: "video/mp4", textContent: undefined });
  await syncExternalWorkspace(root, [text, video], null);

  const nextText = { ...text, textContent: "新内容", size: new Blob(["新内容"]).size };
  const result = await syncExternalWorkspace(root, [nextText], null);
  assert.equal(result.removed, 1);
  const restored = await readExternalWorkspace(root);
  assert.equal(restored.records.length, 1);
  assert.equal(await restored.records[0].file.text(), "新内容");
});

test("requests directory permission only when reconnecting is allowed", async () => {
  const root = new MemoryDirectoryHandle("移动硬盘");
  root.permission = "prompt";
  assert.equal(await verifyExternalDirectoryPermission(root, false), false);
  assert.equal(await verifyExternalDirectoryPermission(root, true), true);
});
