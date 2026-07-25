"use client";

import { useEffect, useState } from "react";
import { fetchOwnerChannels } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";

interface OwnerChannel {
  id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  has_passcode: number;
}

interface OwnerChannelsPopupProps {
  currentChannelId: string;
  bubbleColor: string;
  onClose: () => void;
}

export function OwnerChannelsPopup({ currentChannelId, bubbleColor, onClose }: OwnerChannelsPopupProps) {
  const { t } = useLocale();
  const [channels, setChannels] = useState<OwnerChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchOwnerChannels(currentChannelId)
      .then((data) => { if (active) setChannels(data.channels || []); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentChannelId]);

  return (
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,.4)", animation: "ctxFade .2s ease" }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-[300px] rounded-[20px] p-5"
        style={{
          background: "var(--header-bg)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: "0 12px 40px rgba(0,0,0,.15)",
        }}
      >
        {loading ? (
          <div className="py-8 text-center text-[13px]" style={{ color: "var(--meta)" }}>{t("loading")}</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {channels.map((ownerChannel) => {
              const active = ownerChannel.id === currentChannelId;
              return (
                <button
                  key={ownerChannel.id}
                  type="button"
                  className="w-full flex flex-col items-center gap-2 rounded-[14px] px-2 py-3 cursor-pointer font-inherit"
                  style={{
                    border: `2px solid ${active ? bubbleColor : "transparent"}`,
                    background: active ? `${bubbleColor}10` : "transparent",
                    color: "var(--gray-text)",
                  }}
                  onClick={() => {
                    if (active) onClose();
                    else window.location.href = `/ch/${ownerChannel.id}`;
                  }}
                >
                  <span
                    className="w-[52px] h-[52px] rounded-full overflow-hidden flex items-center justify-center text-white text-[18px] font-semibold"
                    style={{
                      backgroundColor: ownerChannel.bubble_color || "#3b8df0",
                      backgroundImage: ownerChannel.profile_image ? `url("${ownerChannel.profile_image}")` : undefined,
                      backgroundPosition: "center",
                      backgroundSize: "cover",
                      border: `2px solid ${active ? bubbleColor : "var(--hairline)"}`,
                    }}
                  >
                    {!ownerChannel.profile_image && ownerChannel.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="max-w-full truncate text-[13px]">{ownerChannel.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
