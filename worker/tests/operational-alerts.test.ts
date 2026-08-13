import assert from "node:assert/strict";
import test from "node:test";

import { getOperationalAlertDecision } from "../src/lib/operational-alerts.ts";

test("critical health alerts immediately and escalates a degraded incident", () => {
  assert.deepEqual(
    getOperationalAlertDecision("critical", "healthy", "healthy"),
    { kind: "critical", nextNotifiedStatus: "critical" },
  );
  assert.deepEqual(
    getOperationalAlertDecision("critical", "degraded", "degraded"),
    { kind: "critical", nextNotifiedStatus: "critical" },
  );
  assert.equal(getOperationalAlertDecision("critical", "critical", "critical"), null);
});

test("degraded health alerts only after two non-healthy windows", () => {
  assert.equal(getOperationalAlertDecision("degraded", "healthy", "healthy"), null);
  assert.deepEqual(
    getOperationalAlertDecision("degraded", "degraded", "healthy"),
    { kind: "degraded", nextNotifiedStatus: "degraded" },
  );
  assert.deepEqual(
    getOperationalAlertDecision("degraded", "critical", "healthy"),
    { kind: "degraded", nextNotifiedStatus: "degraded" },
  );
  assert.equal(getOperationalAlertDecision("degraded", "degraded", "degraded"), null);
  assert.equal(getOperationalAlertDecision("degraded", "degraded", "critical"), null);
});

test("recovery alerts only after two healthy windows", () => {
  assert.equal(getOperationalAlertDecision("healthy", "degraded", "degraded"), null);
  assert.deepEqual(
    getOperationalAlertDecision("healthy", "healthy", "degraded"),
    { kind: "recovery", nextNotifiedStatus: "healthy" },
  );
  assert.deepEqual(
    getOperationalAlertDecision("healthy", "healthy", "critical"),
    { kind: "recovery", nextNotifiedStatus: "healthy" },
  );
  assert.equal(getOperationalAlertDecision("healthy", "healthy", "healthy"), null);
});
