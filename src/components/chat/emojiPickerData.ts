"use client";

const EN_EMOJI_DATA = "https://cdn.jsdelivr.net/npm/emoji-picker-element-data@^1/en/emojibase/data.json";
const KO_EMOJI_DATA = "https://cdn.jsdelivr.net/npm/emoji-picker-element-data@^1/ko/cldr/data.json";

interface EmojiDataEntry {
  emoji: string;
  annotation?: string;
  tags?: string[];
  shortcodes?: string[];
}

let bilingualDataSourcePromise: Promise<string> | null = null;

export function getBilingualDataSource() {
  if (bilingualDataSourcePromise) return bilingualDataSourcePromise;
  bilingualDataSourcePromise = Promise.all([
    fetch(EN_EMOJI_DATA).then((response) => {
      if (!response.ok) throw new Error("English emoji data unavailable");
      return response.json() as Promise<EmojiDataEntry[]>;
    }),
    fetch(KO_EMOJI_DATA).then((response) => {
      if (!response.ok) throw new Error("Korean emoji data unavailable");
      return response.json() as Promise<EmojiDataEntry[]>;
    }),
  ]).then(([english, korean]) => {
    const koreanByEmoji = new Map(korean.map((entry) => [entry.emoji, entry]));
    const merged = english.map((entry) => {
      const localized = koreanByEmoji.get(entry.emoji);
      if (!localized) return entry;
      return {
        ...entry,
        tags: [...new Set([
          ...(entry.tags || []),
          ...(entry.shortcodes || []),
          localized.annotation || "",
          ...(localized.tags || []),
          ...(localized.shortcodes || []),
        ].filter(Boolean))],
      };
    });
    return URL.createObjectURL(new Blob([JSON.stringify(merged)], { type: "application/json" }));
  }).catch(() => KO_EMOJI_DATA);
  return bilingualDataSourcePromise;
}

interface BuildEmojiPickerOptions {
  height: string;
  locale?: string;
  onSelect: (emoji: string) => void;
  width: string;
}

export async function buildEmojiPicker({
  height,
  locale = "ko-x-yap-bilingual",
  onSelect,
  width,
}: BuildEmojiPickerOptions) {
  const [module, dataSource] = await Promise.all([
    import("emoji-picker-element"),
    getBilingualDataSource(),
  ]);

  const picker = new module.Picker({
    locale,
    dataSource,
  }) as HTMLElement;

  picker.addEventListener("emoji-click", (event: Event) => {
    const detail = (event as CustomEvent).detail;
    onSelect(detail.unicode);
  });

  picker.style.setProperty("--border-color", "var(--hairline)");
  picker.style.setProperty("--background", "var(--bg)");
  picker.style.setProperty("--input-border-color", "var(--input-border)");
  picker.style.setProperty("--category-font-size", "14px");
  picker.style.height = height;
  picker.style.width = width;

  return picker;
}
