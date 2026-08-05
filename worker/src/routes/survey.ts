import {
  createAnonymousIdentity,
  verifyAnonymousIdentityToken,
  verifyDeviceIdentityToken,
} from "../lib/anonymous-identity";
import { consumeDurableRateLimit, hashRateLimitIdentifier } from "../lib/durable-rate-limit";
import { parseSurveySubmission } from "../lib/survey-response";
import type { Env } from "../types";

const SURVEY_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SURVEY_RATE_LIMIT = 3;

interface SurveyActor {
  actorKey: string;
  anonymousToken: string | null;
  deviceToken: string | null;
}

async function resolveSurveyActor(
  request: Request,
  env: Env,
  createIfMissing: boolean,
): Promise<SurveyActor | null> {
  const trustedUserId = request.headers.get("X-Internal-Token") === env.INTERNAL_SECRET
    ? request.headers.get("X-User-Id")
    : null;
  if (trustedUserId) {
    return {
      actorKey: await hashRateLimitIdentifier("visit-survey-actor", `user:${trustedUserId}`, env),
      anonymousToken: null,
      deviceToken: null,
    };
  }

  const deviceToken = request.headers.get("X-Device-Token") || "";
  const verifiedDevice = deviceToken
    ? await verifyDeviceIdentityToken(deviceToken, env)
    : null;
  if (verifiedDevice) {
    return {
      actorKey: await hashRateLimitIdentifier("visit-survey-actor", `device:${verifiedDevice.device_id}`, env),
      anonymousToken: null,
      deviceToken: null,
    };
  }

  const anonymousToken = request.headers.get("X-Anonymous-Token") || "";
  const verifiedAnonymous = anonymousToken
    ? await verifyAnonymousIdentityToken(anonymousToken, env)
    : null;
  if (verifiedAnonymous) {
    return {
      actorKey: await hashRateLimitIdentifier("visit-survey-actor", `anonymous:${verifiedAnonymous.uid}`, env),
      anonymousToken: null,
      deviceToken: null,
    };
  }
  if (!createIfMissing) return null;

  const nextAnonymous = await createAnonymousIdentity(env);
  return {
    actorKey: await hashRateLimitIdentifier("visit-survey-actor", `anonymous:${nextAnonymous.uid}`, env),
    anonymousToken: nextAnonymous.token,
    deviceToken: null,
  };
}

function withSurveyIdentityHeaders(response: Response, actor: SurveyActor): Response {
  if (!actor.anonymousToken && !actor.deviceToken) return response;
  const headers = new Headers(response.headers);
  if (actor.anonymousToken) headers.set("X-Anonymous-Token", actor.anonymousToken);
  if (actor.deviceToken) headers.set("X-Device-Token", actor.deviceToken);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export async function handleSurvey(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const actor = await resolveSurveyActor(request, env, request.method === "GET");
  if (!actor) {
    return Response.json({ error: "identity_required" }, { status: 401 });
  }
  if (request.method === "GET") {
    const row = await env.DB.prepare(`
      SELECT 1 AS responded
      FROM visit_survey_responses
      WHERE actor_key = ?
      LIMIT 1
    `).bind(actor.actorKey).first<{ responded: number }>();
    return withSurveyIdentityHeaders(Response.json({ responded: !!row }), actor);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withSurveyIdentityHeaders(
      Response.json({ error: "invalid_json" }, { status: 400 }),
      actor,
    );
  }
  const submission = parseSurveySubmission(body);
  if (!submission) {
    return withSurveyIdentityHeaders(
      Response.json({ error: "invalid_survey_response" }, { status: 400 }),
      actor,
    );
  }

  const rateLimit = await consumeDurableRateLimit({
    env,
    scope: "visit-survey-response",
    subjectKey: actor.actorKey,
    limit: SURVEY_RATE_LIMIT,
    windowMs: SURVEY_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.ok) {
    return withSurveyIdentityHeaders(
      Response.json({ error: "rate_limited" }, { status: 429 }),
      actor,
    );
  }

  await env.DB.prepare(`
    INSERT INTO visit_survey_responses (
      id,
      actor_key,
      outcome,
      description,
      source_page,
      locale,
      visit_count,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_key) DO NOTHING
  `).bind(
    crypto.randomUUID(),
    actor.actorKey,
    submission.outcome,
    submission.description,
    submission.sourcePage,
    submission.locale,
    submission.visitCount,
    new Date().toISOString(),
  ).run();

  return withSurveyIdentityHeaders(Response.json({ ok: true }), actor);
}
