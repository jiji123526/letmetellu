import assert from "node:assert/strict";
import test from "node:test";
import { createD1ReadSessionEnv } from "../src/lib/d1-read-session.ts";
import type { Env } from "../src/types.ts";

test("D1 read sessions preserve the requested first-query consistency", () => {
  const constraints: string[] = [];
  const session = { prepare() {}, batch() {} };
  const env = {
    DB: {
      withSession(constraint: string) {
        constraints.push(constraint);
        return session;
      },
    },
  } as unknown as Env;

  const primaryEnv = createD1ReadSessionEnv(env, "first-primary");
  const replicaEnv = createD1ReadSessionEnv(env, "first-unconstrained");

  assert.deepEqual(constraints, ["first-primary", "first-unconstrained"]);
  assert.equal(primaryEnv.DB, session);
  assert.equal(replicaEnv.DB, session);
});

test("D1 read sessions fall back for local bindings without Sessions API", () => {
  const env = { DB: { prepare() {}, batch() {} } } as unknown as Env;
  assert.equal(createD1ReadSessionEnv(env, "first-primary"), env);
});

test("D1 read sessions use a selected channel database", () => {
  const session = { prepare() {}, batch() {} };
  const selectedDatabase = {
    withSession(constraint: string) {
      assert.equal(constraint, "first-primary");
      return session;
    },
  } as unknown as D1Database;
  const env = {
    DB: { prepare() {}, batch() {} },
  } as unknown as Env;

  const readEnv = createD1ReadSessionEnv(
    env,
    "first-primary",
    selectedDatabase,
  );

  assert.equal(readEnv.DB, session);
  assert.notEqual(readEnv, env);
});

test("selected local databases remain selected without Sessions API", () => {
  const env = {
    DB: { prepare() {}, batch() {} },
  } as unknown as Env;
  const selectedDatabase = {
    prepare() {},
    batch() {},
  } as unknown as D1Database;

  const readEnv = createD1ReadSessionEnv(
    env,
    "first-unconstrained",
    selectedDatabase,
  );

  assert.equal(readEnv.DB, selectedDatabase);
  assert.notEqual(readEnv, env);
});
