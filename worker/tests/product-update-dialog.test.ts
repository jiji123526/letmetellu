import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialogSource = readFileSync(
  new URL("../../src/components/ProductUpdateDialog.tsx", import.meta.url),
  "utf8",
);
const providersSource = readFileSync(
  new URL("../../src/components/Providers.tsx", import.meta.url),
  "utf8",
);

test("private DM update dialog is mounted for every interactive provider tree", () => {
  assert.match(providersSource, /<LocaleProvider>[\s\S]*<ProductUpdateDialog \/>[\s\S]*\{children\}/);
});

test("private DM update dialog uses one versioned browser marker", () => {
  assert.match(dialogSource, /yap_product_update_private_dm_replies_v1_seen/);
  const storageWrite = dialogSource.indexOf("localStorage.setItem(STORAGE_KEY, \"true\")");
  const display = dialogSource.indexOf("setVisible(true)");
  assert.ok(storageWrite >= 0);
  assert.ok(display > storageWrite, "the update must be marked before it is displayed");
});

test("private DM update dialog exposes an accessible modal boundary", () => {
  assert.match(dialogSource, /role="dialog"/);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /aria-labelledby="product-update-title"/);
});
