import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the local material library with all four asset types", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Frame Vault · 本地素材终端<\/title>/i);
  assert.match(html, /SAVED LOCALLY/);
  assert.match(html, /全部素材/);
  assert.match(html, /nav-symbol video-symbol/);
  assert.match(html, /nav-symbol audio-symbol/);
  assert.match(html, /nav-symbol image-symbol/);
  assert.match(html, /nav-symbol text-symbol/);
  assert.match(html, /IMAGE \/ VIDEO \/ AUDIO \/ TEXT · DROP HERE/);
  assert.match(html, /accept="[^"]*audio\/\*[^"]*\.mp3[^"]*\.wav[^"]*"/i);
});

test("keeps material persistence and audio handling in the local application", async () => {
  const [page, storage] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/storage.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /file\.type\.startsWith\("audio\/"\)/);
  assert.match(page, /document\.createElement\("audio"\)/);
  assert.match(page, /syncAudioMetadata/);
  assert.match(page, /saveStoredAsset\(toStoredRecord\(asset\)\)/);
  assert.match(page, /asset\.collection === "category" && asset\.category/);
  assert.match(page, /查看全部类目/);
  assert.match(page, /categoryBrowserQuery/);
  assert.doesNotMatch(page, /autoPlay/);
  assert.doesNotMatch(page, /videoExpanded|setVideoExpanded/);
  assert.match(page, /selected\.kind === "video" \? \([\s\S]*?video-preview-controls/);
  assert.match(page, /\(selected\.kind === "image" \|\| selected\.kind === "video"\) && \([\s\S]*?prompt-heading/);
  assert.doesNotMatch(page, /selected\.kind === "audio" \? "记录声音内容/);
  assert.match(page, /if \(!event\.ctrlKey \|\| selected\?\.kind !== "image"\) return;/);
  assert.match(page, /filter === "all"\s*\? \(keyword \? true : asset\.collection === "library"\)/);
  assert.match(page, /asset\.category\.toLowerCase\(\)\.includes\(keyword\)/);
  assert.match(page, /isGlobalAssetSearch && asset\.collection === "category"/);
  assert.match(page, /createFrameVaultBackup/);
  assert.match(page, /parseFrameVaultBackup/);
  assert.match(page, /选择硬盘 \/ U盘目录/);
  assert.match(page, /flushExternalSync/);
  assert.match(page, /重新连接/);
  assert.match(page, /安全合并/);
  assert.match(page, /完全恢复/);
  const moveHandler = page.match(/const moveSelectedAsset = \(destination: string\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? "";
  assert.doesNotMatch(moveHandler, /setFilter/);
  assert.match(storage, /indexedDB\.open/);
  assert.match(storage, /"image" \| "video" \| "audio" \| "text"/);
  assert.match(storage, /restoreStoredWorkspace/);
  assert.match(storage, /loadStoredExternalDirectory/);
  assert.match(storage, /saveStoredExternalDirectory/);
  assert.match(storage, /SETTINGS_STORE_NAME/);
  assert.match(storage, /database\.transaction\(\[STORE_NAME, PROMPT_STORE_NAME\], "readwrite"\)/);
});

test("keeps the sidebar usable when the available viewport height changes", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /className="side-panel-scroll"/);
  assert.match(page, /aria-expanded=\{isLocalStatusExpanded\}/);
  assert.match(styles, /height:\s*100dvh/);
  assert.match(styles, /\.side-panel-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.workspace-grid\s*\{[^}]*min-height:\s*0/s);
});
