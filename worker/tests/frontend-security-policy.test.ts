import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nextConfigSource = readFileSync(
  new URL("../../next.config.ts", import.meta.url),
  "utf8",
);

test("frontend CSP allows the official Toss Payments SDK script origin", () => {
  const scriptSourceStart = nextConfigSource.indexOf("const scriptSrc = [");
  const connectSourceStart = nextConfigSource.indexOf("const connectSrc = [");
  const scriptSources = nextConfigSource.slice(scriptSourceStart, connectSourceStart);

  assert.ok(scriptSourceStart >= 0);
  assert.ok(connectSourceStart > scriptSourceStart);
  assert.match(scriptSources, /https:\/\/js\.tosspayments\.com/);
});
