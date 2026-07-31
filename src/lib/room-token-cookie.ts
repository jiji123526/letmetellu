import type { NextResponse } from "next/server";

const ROOM_TOKEN_COOKIE_PREFIX = "roomToken_";
const ROOM_TOKEN_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function shouldUseSecureCookies(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export function getRoomTokenCookieName(channelId: string): string {
  return `${ROOM_TOKEN_COOKIE_PREFIX}${encodeURIComponent(channelId)}`;
}

export function setRoomTokenResponseCookie(
  response: NextResponse,
  request: Request,
  channelId: string,
  token: string,
) {
  response.cookies.set({
    name: getRoomTokenCookieName(channelId),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(request),
    path: "/",
    maxAge: ROOM_TOKEN_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearRoomTokenResponseCookie(
  response: NextResponse,
  request: Request,
  channelId: string,
) {
  response.cookies.set({
    name: getRoomTokenCookieName(channelId),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(request),
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export function readRoomTokenCookie(cookieHeader: string | null | undefined, channelId: string): string | null {
  if (!cookieHeader) return null;
  const cookieName = getRoomTokenCookieName(channelId);
  const cookies = cookieHeader.split(/;\s*/);

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex < 0) continue;
    const name = cookie.slice(0, separatorIndex);
    if (name !== cookieName) continue;
    const value = cookie.slice(separatorIndex + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}
