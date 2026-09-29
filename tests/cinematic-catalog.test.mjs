import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const expectedCounts = {
  "assets.json": 12,
  "camera-motion.json": 41,
  "lighting.json": 38,
  "composition.json": 21,
  "editing.json": 17,
  "narrative.json": 12,
  "visual-effects.json": 8,
  "genre-style.json": 82,
  "film-stock.json": 200,
  "camera-body.json": 21,
  "lens-character.json": 16,
  "aesthetic.json": 12,
  "environment.json": 3,
  "templates.json": 5,
};

test("cinematic library contains 488 complete entries with distinct source images", async () => {
  const rows = [];

  for (const [fileName, expectedCount] of Object.entries(expectedCounts)) {
    const filePath = path.join(process.cwd(), "app", "cinematic-data", fileName);
    const categoryRows = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(categoryRows.length, expectedCount, `${fileName} count`);
    rows.push(...categoryRows);
  }

  assert.equal(rows.length, 488);
  assert.equal(new Set(rows.map((row) => row.title)).size, 488);
  assert.equal(new Set(rows.map((row) => row.img)).size, 488);

  for (const row of rows) {
    assert.equal(typeof row.title, "string");
    assert.ok(row.title.trim());
    assert.ok(row.description.trim());
    assert.ok(row.prompt.trim());
    assert.match(row.img, /^https:\/\/zcdn\.rytesa\.cn\//);
    assert.ok(row.alt.trim());
  }
});
