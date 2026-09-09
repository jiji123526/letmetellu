import { withDatabase } from "./database-access.ts";
import type { Env } from "../types.ts";

export type D1ReadConstraint = "first-primary" | "first-unconstrained";

/**
 * Keep one logical request on a sequentially-consistent D1 session. A request
 * without a trusted channel capability starts on primary so access state is
 * current; capability-authorized reads may start on a nearby replica.
 *
 * Local and older test doubles do not expose withSession(), so they safely
 * fall back to the original binding.
 */
export function createD1ReadSessionEnv(
  env: Env,
  constraint: D1ReadConstraint,
  selectedDatabase: D1Database = env.DB,
): Env {
  const database = selectedDatabase as D1Database & {
    withSession?: (constraint?: D1ReadConstraint) => D1DatabaseSession;
  };
  if (typeof database.withSession !== "function") {
    return withDatabase(env, selectedDatabase);
  }

  return withDatabase(
    env,
    database.withSession(constraint) as unknown as D1Database,
  );
}
