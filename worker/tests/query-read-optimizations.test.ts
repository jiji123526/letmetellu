import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL("../migrations/0041_retention_lookup_index.sql", import.meta.url),
  "utf8",
);
const maintenanceSource = readFileSync(
  new URL("../src/lib/maintenance.ts", import.meta.url),
  "utf8",
);

test("actor identity retention has a global age index", () => {
  assert.match(
    migrationSource,
    /message_actor_identities_created_idx\s+ON message_actor_identities\(created_at\)/,
  );
  assert.match(
    maintenanceSource,
    /SELECT rowid FROM \$\{table\} WHERE \$\{timestampColumn\} < \? ORDER BY \$\{timestampColumn\} ASC LIMIT \?/,
  );
});
