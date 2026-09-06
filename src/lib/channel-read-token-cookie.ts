import type { NextResponse } from "next/server";

const CHANNEL_READ_COOKIE_PREFIX = "channelRead_";
const CHANNEL_READ_COOKIE_MAX_AGE_SECONDS = 2 * 60;

function cookieName(channelId: string) {
  return `${CHANNEL_READ_COOKIE_PREFIX}${encodeURIComponent(channelId)}`;
}

function secureCookie(request: Request) {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export function setChannelReadTokenCookie(
  response: NextResponse,
  request: Request,
  channelId: string,
  token: string,
) {
  response.cookies.set({
    name: cookieName(channelId),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(request),
    path: "/",
    maxAge: CHANNEL_READ_COOKIE_MAX_AGE_SECONDS,
  });
}

export function readChannelReadTokenCookie(
  cookieHeader: string | null | undefined,
  channelId: string,
): string | null {
  if (!cookieHeader) return null;
  const expected = cookieName(channelId);
  for (const cookie of cookieHeader.split(/;\s*/)) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator) !== expected) continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return null;
}
