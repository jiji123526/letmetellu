import assert from "node:assert/strict";
import test from "node:test";

async function loadCurrentUserStateModule(seed: string) {
  return import(
    new URL(`../../src/lib/current-user-state.ts?cache-test=${seed}`, import.meta.url).href
  );
}

test("failed current user reads are cached briefly before retrying", async () => {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  let now = 1_000;
  let fetchCount = 0;

  Date.now = () => now;
  global.fetch = (async () => {
    fetchCount += 1;
    return {
      ok: false,
      status: 404,
      async json() {
        return { error: "user_not_found" };
      },
    } as Response;
  }) as typeof fetch;

  try {
    const { fetchCurrentUserState } = await loadCurrentUserStateModule(String(now));
    const first = await fetchCurrentUserState("user-1");
    const second = await fetchCurrentUserState("user-1");

    assert.equal(first.ok, false);
    assert.equal(second.status, 404);
    assert.equal(fetchCount, 1);

    now += 5_001;
    const third = await fetchCurrentUserState("user-1");
    assert.equal(third.status, 404);
    assert.equal(fetchCount, 2);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("server-side current user failures are not cached", async () => {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  let now = 10_000;
  let fetchCount = 0;

  Date.now = () => now;
  global.fetch = (async () => {
    fetchCount += 1;
    return {
      ok: false,
      status: 500,
      async json() {
        return { error: "temporary_failure" };
      },
    } as Response;
  }) as typeof fetch;

  try {
    const { fetchCurrentUserState } = await loadCurrentUserStateModule(String(now));
    await fetchCurrentUserState("user-2");
    await fetchCurrentUserState("user-2");
    assert.equal(fetchCount, 2);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});
