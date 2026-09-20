import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const passcodeSource = readFileSync(
  new URL("../src/routes/passcode.ts", import.meta.url),
  "utf8",
);
const workerSource = readFileSync(
  new URL("../src/index.ts", import.meta.url),
  "utf8",
);

test("wrong channel passcodes stay outside the generic forbidden health signal", () => {
  const classifiedRejections = passcodeSource.match(
    /withOperationalEventOverride\([\s\S]*?"wrong_passcode"[\s\S]*?"passcode_rejected"/g,
  ) || [];
  assert.equal(classifiedRejections.length, 2);

  const forbiddenClassifiers = workerSource.match(
    /response\.status === 403[\s\S]*?eventType: getOperationalEventOverride\(response\) \|\| "forbidden"/g,
  ) || [];
  assert.equal(forbiddenClassifiers.length, 2);
});
