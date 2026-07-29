const ROOM_TOKEN_COOKIE_PREFIX = "roomToken_";
const ROOM_TOKEN_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function getSecureCookieAttributes() {
  if (typeof window === "undefined" || window.location.protocol !== "https:") {
    return "";
  }
  return "; Secure";
}

export function getRoomTokenCookieName(channelId: string): string {
  return `${ROOM_TOKEN_COOKIE_PREFIX}${encodeURIComponent(channelId)}`;
}

export function setRoomTokenCookie(channelId: string, token: string) {
  if (typeof document === "undefined") return;
  document.cookie = [
    `${getRoomTokenCookieName(channelId)}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${ROOM_TOKEN_COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ") + getSecureCookieAttributes();
}

export function clearRoomTokenCookie(channelId: string) {
  if (typeof document === "undefined") return;
  document.cookie = [
    `${getRoomTokenCookieName(channelId)}=`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ") + getSecureCookieAttributes();
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
