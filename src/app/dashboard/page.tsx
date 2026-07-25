"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { clearRecentChannels, getRecentChannels, removeRecentChannel, type RecentChannel } from "@/lib/recent-channels";

interface Channel {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  created_at: string;
}

type DashboardTab = "owned" | "recent";

function formatDate(value: string, locale: "ko" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" }).format(date);
}

function formatRelativeTime(timestamp: number, locale: "ko" | "en") {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return locale === "ko" ? "방금" : "Now";
  if (minutes < 60) return locale === "ko" ? `${minutes}분 전` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "ko" ? `${hours}시간 전` : `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return locale === "ko" ? `${days}일 전` : `${days}d`;
  return formatDate(new Date(timestamp).toISOString(), locale);
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { locale, t } = useLocale();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DashboardTab>("owned");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const loadChannels = useCallback(async () => {
    const response = await fetch("/api/user", { cache: "no-store" });
    const data = await response.json() as { channels?: Channel[] };
    setChannels(data.channels || []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecentChannels(getRecentChannels());
      if (status === "authenticated") {
        void loadChannels().finally(() => setLoading(false));
      } else if (status === "unauthenticated") {
        setTab("recent");
        setLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [status, loadChannels]);

  const activeItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const items = tab === "owned"
      ? channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          profileImage: channel.profile_image,
          bubbleColor: channel.bubble_color,
          meta: `/ch/${channel.id}`,
          time: formatDate(channel.created_at, locale),
          owned: true,
        }))
      : recentChannels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          profileImage: channel.profileImage,
          bubbleColor: channel.bubbleColor,
          meta: `/ch/${channel.id}`,
          time: formatRelativeTime(channel.lastVisitedAt, locale),
          owned: false,
        }));
    if (!normalized) return items;
    return items.filter((item) => item.name.toLowerCase().includes(normalized) || item.id.toLowerCase().includes(normalized));
  }, [tab, channels, recentChannels, query, locale]);

  const handleCreate = async () => {
    const slug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const name = newName.trim();
    setCreateError("");
    if (!slug || !name) return setCreateError(t("allFieldsRequired"));
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) return setCreateError(t("onboardingSlugHint"));
    setCreating(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-channel", channel_id: slug, payload: { name } }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) {
        setCreateError(data.error === "channel already exists" ? t("channelExists") : t("dashboardCreateFailed"));
        return;
      }
      await loadChannels();
      setNewSlug("");
      setNewName("");
      setShowCreate(false);
      setTab("owned");
    } catch {
      setCreateError(t("dashboardCreateFailed"));
    } finally {
      setCreating(false);
    }
  };

  const removeRecent = (channelId: string) => {
    removeRecentChannel(channelId);
    setRecentChannels(getRecentChannels());
  };

  const clearRecent = () => {
    clearRecentChannels();
    setRecentChannels([]);
  };

  if (status === "loading" || loading) {
    return <main className="min-h-dvh flex items-center justify-center bg-white"><span className="text-[14px]" style={{ color: "#8e8e93" }}>{t("loading")}</span></main>;
  }

  const isLoggedIn = !!session;
  const empty = activeItems.length === 0;

  return (
    <main className="min-h-dvh bg-white" style={{ color: "#111" }}>
      <div className="max-w-[760px] mx-auto min-h-dvh md:border-x" style={{ borderColor: "#ededf0" }}>
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xl">
          <div className="h-[64px] px-4 flex items-center justify-between">
            <button
              type="button"
              className="border-none bg-transparent cursor-pointer text-[14px] min-w-[72px] text-left"
              style={{ color: "#007aff" }}
              onClick={() => {
                if (tab === "recent" && recentChannels.length) clearRecent();
                else if (isLoggedIn) setShowAccount((value) => !value);
              }}
            >
              {tab === "recent" && recentChannels.length ? t("dashboardClear") : isLoggedIn ? t("dashboardAccount") : ""}
            </button>
            <h1 className="m-0 text-[17px] font-semibold">{t("dashboardChats")}</h1>
            <div className="min-w-[72px] flex justify-end relative">
              {isLoggedIn ? (
                <button
                  type="button"
                  className="w-9 h-9 rounded-full border-none cursor-pointer text-[20px] leading-none"
                  style={{ background: "#f2f2f7" }}
                  onClick={() => {
                    setCreateError("");
                    setShowCreate(true);
                  }}
                  aria-label={t("createChannel")}
                >
                  ＋
                </button>
              ) : (
                <button type="button" className="border-none bg-transparent cursor-pointer text-[14px]" style={{ color: "#007aff" }} onClick={() => router.push("/login")}>{t("loginTab")}</button>
              )}
              {showAccount && isLoggedIn && (
                <>
                  <button className="fixed inset-0 z-10 border-none bg-transparent" aria-label={t("close")} onClick={() => setShowAccount(false)} />
                  <div className="absolute right-0 top-[42px] z-20 w-[230px] rounded-[14px] p-2 text-left" style={{ background: "#fff", border: "1px solid #e5e5ea", boxShadow: "0 14px 40px rgba(0,0,0,.14)" }}>
                    <div className="px-3 py-2 text-[12px] truncate" style={{ color: "#8e8e93" }}>{session.user?.email}</div>
                    <button className="w-full border-none rounded-[10px] cursor-pointer text-left px-3 py-2.5 text-[13px]" style={{ background: "#f2f2f7", color: "#ff3b30" }} onClick={() => signOut({ callbackUrl: "/login" })}>{t("logout")}</button>
                  </div>
                </>
              )}
            </div>
          </div>

          {isLoggedIn && (
            <div className="mx-4 mb-3 p-1 rounded-[10px] flex" style={{ background: "#f2f2f7" }}>
              {(["owned", "recent"] as DashboardTab[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className="flex-1 border-none rounded-[8px] cursor-pointer py-1.5 text-[13px] font-medium"
                  style={{ background: tab === item ? "#fff" : "transparent", color: tab === item ? "#111" : "#6d6d72", boxShadow: tab === item ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}
                  onClick={() => {
                    setTab(item);
                    setQuery("");
                  }}
                >
                  {item === "owned" ? t("dashboardOwnedTab") : t("dashboardRecentTab")}
                </button>
              ))}
            </div>
          )}

          <div className="px-4 pb-3">
            <div className="relative">
              <svg viewBox="0 0 24 24" className="absolute left-10 top-1/2 -translate-y-1/2 w-4 h-4" fill="none" stroke="#8e8e93" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("dashboardSearch")} className="w-full border-none rounded-[11px] outline-none text-[15px] text-center" style={{ background: "#f2f2f7", padding: "9px 38px", boxSizing: "border-box" }} />
            </div>
          </div>
          <div className="h-px ml-[80px]" style={{ background: "#e5e5ea" }} />
        </header>

        {empty ? (
          <section className="px-8 py-24 text-center">
            <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-[28px] mb-4" style={{ background: "#f2f2f7" }}>💬</div>
            <h2 className="m-0 text-[19px] font-semibold">{query ? t("dashboardNoSearchResults") : tab === "owned" ? t("noChannels") : t("dashboardNoRecent")}</h2>
            {!query && <p className="mt-2 mb-5 text-[14px] leading-[1.5]" style={{ color: "#8e8e93" }}>{tab === "owned" ? t("dashboardEmptyDesc") : t("dashboardRecentDesc")}</p>}
            {!query && tab === "owned" && <button className="border-none bg-transparent cursor-pointer text-[15px] font-medium" style={{ color: "#007aff" }} onClick={() => setShowCreate(true)}>{t("dashboardFirstChannel")}</button>}
            {!query && tab === "recent" && !isLoggedIn && <button className="border-none bg-transparent cursor-pointer text-[15px] font-medium" style={{ color: "#007aff" }} onClick={() => router.push("/login")}>{t("dashboardGuestCta")}</button>}
          </section>
        ) : (
          <section>
            {activeItems.map((item) => (
              <div key={item.id} className="flex items-center min-h-[82px] pl-4 cursor-pointer" onClick={() => router.push(`/ch/${item.id}`)}>
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden text-white font-semibold text-[17px]" style={{ backgroundColor: item.bubbleColor || "#007aff", backgroundImage: item.profileImage ? `url("${item.profileImage}")` : undefined, backgroundPosition: "center", backgroundSize: "cover" }}>
                  {!item.profileImage && item.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="self-stretch min-w-0 flex-1 ml-4 pr-4 flex items-center border-b" style={{ borderColor: "#e5e5ea" }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="m-0 truncate text-[16px] font-semibold">{item.name}</h2>
                      {item.owned && <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "#eaf3ff", color: "#007aff" }}>{t("dashboardManaged")}</span>}
                    </div>
                    <p className="m-0 mt-1 truncate text-[14px]" style={{ color: "#8e8e93" }}>{item.meta}</p>
                  </div>
                  <span className="ml-3 text-[13px] whitespace-nowrap" style={{ color: "#8e8e93" }}>{item.time}</span>
                  <span className="ml-2 text-[23px] font-light" style={{ color: "#c7c7cc" }}>›</span>
                  {!item.owned && (
                    <button type="button" className="ml-1 border-none bg-transparent cursor-pointer text-[18px]" style={{ color: "#c7c7cc" }} aria-label={t("delete")} onClick={(event) => { event.stopPropagation(); removeRecent(item.id); }}>×</button>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        {!isLoggedIn && recentChannels.length > 0 && (
          <div className="px-5 py-8 text-center">
            <button className="border-none bg-transparent cursor-pointer text-[14px]" style={{ color: "#007aff" }} onClick={() => router.push("/login")}>{t("dashboardGuestCta")}</button>
          </div>
        )}
      </div>

      {showCreate && isLoggedIn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" style={{ background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)" }} onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) setShowCreate(false); }}>
          <div className="w-full max-w-[390px] rounded-[20px] p-6" style={{ background: "#fff", boxShadow: "0 24px 70px rgba(0,0,0,.22)" }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="m-0 text-[19px] font-semibold">{t("onboardingTitle")}</h2>
              <button className="border-none bg-transparent cursor-pointer text-[22px]" style={{ color: "#8e8e93" }} onClick={() => setShowCreate(false)}>×</button>
            </div>
            <label className="block text-[12px] font-medium mb-1.5">{t("channelName")}</label>
            <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={30} className="w-full rounded-[11px] outline-none text-[15px] mb-4" style={{ border: "1px solid #d1d1d6", padding: "11px 12px", boxSizing: "border-box" }} />
            <label className="block text-[12px] font-medium mb-1.5">{t("channelSlug")}</label>
            <div className="flex items-center rounded-[11px]" style={{ border: "1px solid #d1d1d6" }}>
              <span className="pl-3 text-[13px]" style={{ color: "#8e8e93" }}>/ch/</span>
              <input value={newSlug} onChange={(event) => setNewSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={30} placeholder="my-channel" className="min-w-0 flex-1 border-none outline-none text-[15px]" style={{ padding: "11px 12px 11px 2px", background: "transparent" }} onKeyDown={(event) => { if (event.key === "Enter" && !creating) void handleCreate(); }} />
            </div>
            <div className="mt-1.5 text-[11px]" style={{ color: "#8e8e93" }}>{t("onboardingSlugHint")}</div>
            <div className="min-h-[20px] mt-2 text-[12px]" style={{ color: "#ff3b30" }}>{createError}</div>
            <div className="flex gap-2 mt-3">
              <button className="flex-1 rounded-[11px] cursor-pointer text-[14px]" style={{ border: "1px solid #d1d1d6", background: "#fff", padding: "11px" }} onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button disabled={creating} className="flex-1 border-none rounded-[11px] text-white text-[14px] font-semibold" style={{ background: creating ? "#9ec9f5" : "#007aff", padding: "12px", cursor: creating ? "wait" : "pointer" }} onClick={() => void handleCreate()}>{creating ? t("loading") : t("create")}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
