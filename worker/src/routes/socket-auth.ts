import { createAnonymousIdentity, createDeviceIdentity, verifyAnonymousIdentityToken, verifyDeviceIdentityToken } from "../lib/anonymous-identity";
import { getParentChannelId, isPlatformAdmin, isReportsChannel } from "../lib/special-channels";
import type { Env } from "../types";
import { authorizeRoomToken } from "./passcode";
import { getTrustedUserId } from "../lib/trusted-identity";

export async function handleSocketAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const channelId = url.searchParams.get("channel");
  if (!channelId) {
    return Response.json({ error: "missing channel" }, { status: 400 });
  }

  const parentChannelId = getParentChannelId(channelId);
  const channel = await env.DB.prepare("SELECT id, owner_uid, passcode FROM channels WHERE id = ?")
    .bind(parentChannelId)
    .first<{ id: string; owner_uid: string; passcode: string | null }>();
  if (!channel) {
    return Response.json({ error: "channel not found" }, { status: 404 });
  }

  const trustedUserId = getTrustedUserId(request, env) || "";
  const isOwner = trustedUserId === channel.owner_uid;
  if (isOwner) {
    return Response.json({ mode: "admin", userId: trustedUserId });
  }

  if (isReportsChannel(parentChannelId, env) && !isOwner) {
    return Response.json({ error: "owner access required" }, { status: 403 });
  }
  const isPlatformAdminViewer = Boolean(channel.passcode)
    && await isPlatformAdmin(trustedUserId, env);
  if (isPlatformAdminViewer) {
    return Response.json({ mode: "viewer", userId: trustedUserId });
  }

  if (!channel.passcode) {
    return new Response(null, { status: 204 });
  }

  const roomToken = request.headers.get("X-Room-Token") || "";
  if (!roomToken) {
    return new Response(null, { status: 204 });
  }

  const decodedRoom = await authorizeRoomToken(roomToken, parentChannelId, channel.passcode, env);
  if (!decodedRoom) {
    return Response.json({ error: "invalid room token" }, { status: 403 });
  }

  const anonymousToken = request.headers.get("X-Anonymous-Token") || "";
  const deviceToken = request.headers.get("X-Device-Token") || "";
  const verifiedAnonymous = anonymousToken
    ? await verifyAnonymousIdentityToken(anonymousToken, env)
    : null;
  const verifiedDevice = deviceToken
    ? await verifyDeviceIdentityToken(deviceToken, env)
    : null;
  const anonymousIdentity = verifiedAnonymous
    ? { uid: verifiedAnonymous.uid, token: anonymousToken }
    : await createAnonymousIdentity(env);
  const deviceIdentity = verifiedDevice
    ? { deviceId: verifiedDevice.device_id, token: deviceToken }
    : await createDeviceIdentity(env);

  return Response.json({
    mode: "room",
    userId: anonymousIdentity.uid,
    anonymousUid: anonymousIdentity.uid,
    anonymousToken: anonymousIdentity.token,
    deviceToken: deviceIdentity.token,
  });
}
