export function parseServerDate(value: string): Date | null {
  if (!value) return null;
  // D1 DATETIME values have no timezone suffix but are stored in UTC.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function chatDateKey(value: string, timeZone: string): string {
  const date = parseServerDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function chatDateLabel(value: string, locale: "ko" | "en", timeZone: string): string {
  const date = parseServerDate(value);
  if (!date) return "";
  if (locale === "ko") {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}. ${part("month")}. ${part("day")}`;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

const chatTimeFormatters = new Map<string, Intl.DateTimeFormat>();

export function chatTimeLabel(value: string, locale: "ko" | "en", timeZone: string): string {
  const date = parseServerDate(value);
  if (!date) return "";
  const formatterKey = `${locale}:${timeZone}`;
  let formatter = chatTimeFormatters.get(formatterKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    });
    chatTimeFormatters.set(formatterKey, formatter);
  }
  return formatter.format(date);
}
