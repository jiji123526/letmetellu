import { cookies, headers } from "next/headers";

export type AppLocale = "ko" | "en";

export async function getRequestLocale(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("locale")?.value;
  if (cookieLocale === "ko" || cookieLocale === "en") {
    return cookieLocale;
  }

  const acceptLanguage = (await headers()).get("accept-language") || "";
  return acceptLanguage.toLowerCase().startsWith("ko") ? "ko" : "en";
}
