"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

interface Channel {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  created_at: string;
}

function formatChannelDate(value: string, locale: "ko" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { locale, t } = useLocale();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      const response = await fetch("/api/user", { cache: "no-store" });
      const data = await response.json() as { channels?: Channel[] };
      setChannels(data.channels || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated") void loadChannels();
  }, [status, router, loadChannels]);

  const filteredChannels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return channels;
    return channels.filter((channel) =>
      channel.name.toLowerCase().includes(normalized)
      || channel.id.toLowerCase().includes(normalized)
    );
  }, [channels, query]);

  const handleCreate = async () => {
    const slug = newSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const name = newName.trim();
    setCreateError("");

    if (!slug || !name) {
      setCreateError(t("allFieldsRequired"));
      return;
    }
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) {
      setCreateError(t("onboardingSlugHint"));
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-channel",
          channel_id: slug,
          payload: { name },
        }),
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
    } catch {
      setCreateError(t("dashboardCreateFailed"));
    } finally {
      setCreating(false);
    }
  };

  const copyChannelLink = async (channelId: string) => {
    const url = `${window.location.origin}/ch/${channelId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopiedId(channelId);
    window.setTimeout(() => setCopiedId((current) => current === channelId ? null : current), 1600);
  };

  const openCreate = () => {
    setCreateError("");
    setShowCreate(true);
  };

  if (status === "loading" || loading) {
    return (
      <main className="min-h-dvh flex items-center justify-center" style={{ background: "#f6f7f9" }}>
        <div className="flex items-center gap-2" style={{ color: "#8a8f98", fontSize: "14px" }}>
          <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#3b8df0" }} />
          {t("loading")}
        </div>
      </main>
    );
  }

  if (!session) return null;

  return (
    <main className="min-h-dvh" style={{ background: "#f6f7f9", color: "#20242a" }}>
      <header className="sticky top-0 z-30" style={{ background: "rgba(255,255,255,.92)", borderBottom: "1px solid #e9ebef", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}>
        <div className="max-w-[1120px] mx-auto h-[68px] px-5 md:px-8 flex items-center justify-between">
          <button
            type="button"
            className="border-none bg-transparent cursor-pointer flex items-center gap-2 p-0"
            onClick={() => router.push("/dashboard")}
          >
            <span className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[16px]" style={{ background: "#20242a", color: "#fff" }}>💬</span>
            <span className="text-[18px] font-semibold tracking-[-0.3px]" style={{ color: "#20242a" }}>letmetellu</span>
          </button>

          <div className="relative flex items-center gap-3">
            <button
              type="button"
              className="border-none cursor-pointer flex items-center gap-2 rounded-full"
              style={{ background: "#f1f3f6", padding: "6px 10px 6px 6px", color: "#424750" }}
              onClick={() => setShowAccount((value) => !value)}
              aria-label={t("dashboardAccount")}
            >
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden text-white text-[12px] font-semibold"
                style={{
                  backgroundColor: "#3b8df0",
                  backgroundImage: session.user?.image ? `url("${session.user.image}")` : undefined,
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                }}
              >
                {!session.user?.image && (session.user?.email?.[0] || "A").toUpperCase()}
              </span>
              <span className="hidden sm:block max-w-[170px] truncate text-[13px]">{session.user?.email}</span>
              <span style={{ color: "#8b9098", fontSize: "12px" }}>⌄</span>
            </button>

            {showAccount && (
              <>
                <button className="fixed inset-0 z-10 border-none bg-transparent" aria-label={t("close")} onClick={() => setShowAccount(false)} />
                <div className="absolute right-0 top-[46px] z-20 w-[230px] rounded-[14px] p-2" style={{ background: "#fff", border: "1px solid #e7e9ed", boxShadow: "0 14px 40px rgba(22,28,38,.12)" }}>
                  <div className="px-3 py-2 mb-1">
                    <div className="text-[11px]" style={{ color: "#979ca5" }}>{t("dashboardAccount")}</div>
                    <div className="text-[13px] truncate mt-1" style={{ color: "#363b43" }}>{session.user?.email}</div>
                  </div>
                  <button
                    type="button"
                    className="w-full border-none rounded-[10px] cursor-pointer text-left px-3 py-2.5 text-[13px]"
                    style={{ background: "#f6f7f9", color: "#d14343" }}
                    onClick={() => signOut({ callbackUrl: "/login" })}
                  >
                    {t("logout")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1120px] mx-auto px-5 md:px-8 py-8 md:py-12">
        <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h1 className="m-0 text-[28px] md:text-[34px] font-semibold tracking-[-1px]">{t("dashboardTitle")}</h1>
              <span className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: "#e9f2ff", color: "#2776d2" }}>{channels.length}</span>
            </div>
            <p className="m-0 text-[14px] md:text-[15px]" style={{ color: "#7a8089" }}>{t("dashboardDesc")}</p>
          </div>
          <button
            type="button"
            className="border-none rounded-[12px] cursor-pointer text-white font-semibold flex items-center justify-center gap-2"
            style={{ background: "#20242a", padding: "12px 17px", fontSize: "14px", boxShadow: "0 7px 18px rgba(32,36,42,.16)" }}
            onClick={openCreate}
          >
            <span className="text-[19px] leading-none">＋</span>
            {t("createChannel")}
          </button>
        </section>

        {channels.length > 0 && (
          <div className="mb-6 max-w-[420px] relative">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[17px] h-[17px]" fill="none" stroke="#9aa0a9" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("dashboardSearch")}
              className="w-full rounded-[12px] outline-none text-[14px]"
              style={{ border: "1px solid #e1e4e9", background: "#fff", color: "#292e35", padding: "11px 14px 11px 40px", boxSizing: "border-box" }}
            />
          </div>
        )}

        {channels.length === 0 ? (
          <section className="rounded-[22px] flex flex-col items-center text-center px-6 py-16 md:py-20" style={{ background: "#fff", border: "1px solid #e8eaee" }}>
            <div className="w-16 h-16 rounded-[20px] flex items-center justify-center text-[28px] mb-5" style={{ background: "#eef5ff" }}>💬</div>
            <h2 className="m-0 text-[20px] font-semibold">{t("noChannels")}</h2>
            <p className="mt-2 mb-6 text-[14px] leading-[1.6] max-w-[340px]" style={{ color: "#858b94" }}>{t("dashboardEmptyDesc")}</p>
            <button type="button" className="border-none rounded-[12px] cursor-pointer text-white font-semibold" style={{ background: "#3b8df0", padding: "12px 18px", fontSize: "14px" }} onClick={openCreate}>
              {t("dashboardFirstChannel")}
            </button>
          </section>
        ) : filteredChannels.length === 0 ? (
          <div className="rounded-[18px] text-center py-14 text-[14px]" style={{ background: "#fff", border: "1px solid #e8eaee", color: "#8b919a" }}>
            {t("dashboardNoSearchResults")}
          </div>
        ) : (
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredChannels.map((channel) => (
              <article
                key={channel.id}
                className="group relative overflow-hidden rounded-[18px] cursor-pointer transition-transform duration-150 hover:-translate-y-0.5"
                style={{ background: "#fff", border: "1px solid #e6e8ec", boxShadow: "0 4px 14px rgba(25,31,40,.035)" }}
                onClick={() => router.push(`/ch/${channel.id}`)}
              >
                <div className="h-1.5" style={{ background: channel.bubble_color || "#3b8df0" }} />
                <div className="p-5">
                  <div className="flex items-start gap-3.5">
                    <div
                      className="w-12 h-12 rounded-[14px] flex-shrink-0 flex items-center justify-center overflow-hidden text-white font-semibold"
                      style={{
                        backgroundColor: channel.bubble_color || "#3b8df0",
                        backgroundImage: channel.profile_image ? `url("${channel.profile_image}")` : undefined,
                        backgroundPosition: "center",
                        backgroundSize: "cover",
                      }}
                    >
                      {!channel.profile_image && channel.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="m-0 text-[16px] font-semibold truncate tracking-[-0.2px]">{channel.name}</h2>
                      <p className="m-0 mt-1 text-[12px] truncate" style={{ color: "#9298a1" }}>/ch/{channel.id}</p>
                    </div>
                    <span className="text-[19px]" style={{ color: "#b1b5bc" }}>›</span>
                  </div>

                  <div className="mt-5 pt-4 flex items-center justify-between gap-3" style={{ borderTop: "1px solid #f0f1f3" }}>
                    <span className="text-[11px]" style={{ color: "#a0a5ad" }}>
                      {formatChannelDate(channel.created_at, locale)}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-[9px] cursor-pointer text-[12px] font-medium"
                        style={{ border: "1px solid #dde1e6", background: "#fff", color: copiedId === channel.id ? "#27834e" : "#575d66", padding: "7px 10px" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyChannelLink(channel.id);
                        }}
                      >
                        {copiedId === channel.id ? t("dashboardCopied") : t("dashboardCopyLink")}
                      </button>
                      <button
                        type="button"
                        className="border-none rounded-[9px] cursor-pointer text-[12px] font-semibold text-white"
                        style={{ background: channel.bubble_color || "#3b8df0", padding: "8px 11px" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/ch/${channel.id}`);
                        }}
                      >
                        {t("dashboardOpen")}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}

            <button
              type="button"
              className="min-h-[170px] rounded-[18px] cursor-pointer flex flex-col items-center justify-center gap-2 transition-colors"
              style={{ border: "1.5px dashed #cfd4db", background: "rgba(255,255,255,.45)", color: "#777e88" }}
              onClick={openCreate}
            >
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-[22px]" style={{ background: "#fff", border: "1px solid #e1e4e8", color: "#4f5660" }}>＋</span>
              <span className="text-[13px] font-semibold">{t("createChannel")}</span>
            </button>
          </section>
        )}
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5"
          style={{ background: "rgba(21,25,31,.46)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)" }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creating) setShowCreate(false);
          }}
        >
          <div className="w-full max-w-[410px] rounded-[20px] p-6 md:p-7" style={{ background: "#fff", boxShadow: "0 24px 70px rgba(15,20,28,.23)" }}>
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="m-0 text-[21px] font-semibold tracking-[-.4px]">{t("onboardingTitle")}</h2>
                <p className="m-0 mt-1.5 text-[13px]" style={{ color: "#898f98" }}>{t("dashboardCreateDesc")}</p>
              </div>
              <button type="button" disabled={creating} className="border-none bg-transparent cursor-pointer text-[20px]" style={{ color: "#969ba3" }} onClick={() => setShowCreate(false)}>×</button>
            </div>

            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#616771" }}>{t("channelName")}</label>
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={30}
              placeholder={t("channelName")}
              className="w-full rounded-[11px] outline-none text-[14px] mb-4"
              style={{ border: "1.5px solid #e0e3e8", background: "#fafbfc", padding: "11px 13px", boxSizing: "border-box" }}
            />

            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#616771" }}>{t("channelSlug")}</label>
            <div className="flex items-center rounded-[11px] overflow-hidden" style={{ border: "1.5px solid #e0e3e8", background: "#fafbfc" }}>
              <span className="pl-3 text-[12px] whitespace-nowrap" style={{ color: "#a0a5ad" }}>/ch/</span>
              <input
                value={newSlug}
                onChange={(event) => setNewSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                maxLength={30}
                placeholder="my-channel"
                className="min-w-0 flex-1 border-none outline-none text-[14px]"
                style={{ background: "transparent", padding: "11px 13px 11px 2px" }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !creating) void handleCreate();
                }}
              />
            </div>
            <div className="mt-1.5 text-[11px]" style={{ color: "#a4a9b1" }}>{t("onboardingSlugHint")}</div>

            <div className="min-h-[20px] mt-2 text-[12px]" style={{ color: "#d14343" }}>{createError}</div>

            <div className="flex gap-2.5 mt-3">
              <button type="button" disabled={creating} className="flex-1 rounded-[11px] cursor-pointer text-[14px] font-medium" style={{ border: "1px solid #e0e3e8", background: "#fff", color: "#626872", padding: "11px" }} onClick={() => setShowCreate(false)}>
                {t("cancel")}
              </button>
              <button type="button" disabled={creating} className="flex-1 border-none rounded-[11px] text-white text-[14px] font-semibold" style={{ background: creating ? "#9bbfe8" : "#3b8df0", cursor: creating ? "wait" : "pointer", padding: "12px" }} onClick={() => void handleCreate()}>
                {creating ? t("loading") : t("create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
