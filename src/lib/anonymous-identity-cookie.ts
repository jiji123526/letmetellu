import type { NextResponse } from "next/server";

export const ANONYMOUS_IDENTITY_COOKIE_NAME = "letsplay_anonymous_token";
export const DEVICE_IDENTITY_COOKIE_NAME = "letsplay_device_token";
const IDENTITY_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

function readCookieValue(cookieHeader: string | null | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(/;\s*/);
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex < 0) continue;
    if (cookie.slice(0, separatorIndex) !== cookieName) continue;
    const value = cookie.slice(separatorIndex + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function shouldUseSecureCookies(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export function readIdentityTokens(cookieHeader: string | null | undefined): {
  anonymousToken: string | null;
  deviceToken: string | null;
} {
  return {
    anonymousToken: readCookieValue(cookieHeader, ANONYMOUS_IDENTITY_COOKIE_NAME),
    deviceToken: readCookieValue(cookieHeader, DEVICE_IDENTITY_COOKIE_NAME),
  };
}

export function setIdentityCookies(
  response: NextResponse,
  request: Request,
  tokens: { anonymousToken?: string | null; deviceToken?: string | null },
): void {
  const secure = shouldUseSecureCookies(request);

  if (tokens.anonymousToken) {
    response.cookies.set({
      name: ANONYMOUS_IDENTITY_COOKIE_NAME,
      value: tokens.anonymousToken,
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: IDENTITY_COOKIE_MAX_AGE_SECONDS,
    });
  }

  if (tokens.deviceToken) {
    response.cookies.set({
      name: DEVICE_IDENTITY_COOKIE_NAME,
      value: tokens.deviceToken,
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: IDENTITY_COOKIE_MAX_AGE_SECONDS,
    });
  }
}
