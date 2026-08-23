"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

const STORAGE_KEY = "yap_product_update_notifications_v1_seen";

export function ProductUpdateDialog() {
  const { locale } = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (localStorage.getItem(STORAGE_KEY) === "true") {
          return;
        }

        localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // Show once for this visit when storage is unavailable.
      }

      setVisible(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const ko = locale !== "en";

  const copy = ko
    ? {
        eyebrow: "NEW",
        title: "알림 기능이 추가됐어요",
        description:
          "로그인한 사용자라면 이제 채널의 중요한 소식을 푸시 알림으로 받아볼 수 있어요.",

        importantTitle: "중요 알림",
        importantBody:
          "멤버는 방장 메시지와 라이브 시작을, 방장은 새 DM과 신고 알림을 받을 수 있어요.",

        allTitle: "모든 알림",
        allBody:
          "중요 알림에 더해 채널의 일반 메시지 알림도 받을 수 있어요.",

        settingsTitle: "채널별로 설정",
        settingsBody:
          "각 채널의 설정에서 알림을 끔 · 중요 · 모두 중 원하는 방식으로 선택할 수 있어요.",

        confirm: "확인",
      }
    : {
        eyebrow: "NEW",
        title: "Notifications are here",
        description:
          "Signed-in users can now receive push notifications for important activity in their channels.",

        importantTitle: "Important",
        importantBody:
          "Members can receive owner messages and live-start alerts. Owners can receive new DM and report alerts.",

        allTitle: "All notifications",
        allBody:
          "Receive important notifications as well as regular channel message alerts.",

        settingsTitle: "Choose per channel",
        settingsBody:
          "Open a channel's settings and choose Off, Important, or All at any time.",

        confirm: "Got it",
      };

  return (
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center px-5 py-6"
      style={{
        background: "rgba(0,0,0,.42)",
        backdropFilter: "blur(5px)",
        WebkitBackdropFilter: "blur(5px)",
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          setVisible(false);
        }
      }}
      role="presentation"
    >
      <section
        className="w-full max-w-[340px] overflow-hidden"
        style={{
          background: "var(--bg, #fff)",
          border: "0.5px solid var(--hairline, rgba(60,60,67,.22))",
          borderRadius: "22px",
          boxShadow: "0 20px 60px rgba(0,0,0,.24)",
          color: "var(--gray-text, #111)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-update-title"
      >
        <div className="px-5 pb-4 pt-5 text-center">
          <div
            className="relative mx-auto mb-3 flex h-[54px] w-[54px] items-center justify-center rounded-[18px]"
            style={{
              background:
                "color-mix(in srgb, var(--tint, #007aff) 12%, var(--bg, #fff))",
              color: "var(--tint, #007aff)",
            }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 32 32"
              className="h-7 w-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 24h12" />
              <path d="M12 27h8" />
              <path d="M8.5 20.5h15" />
              <path d="M10 20.5v-7a6 6 0 0 1 12 0v7" />
              <path d="M7 20.5h18" />
            </svg>

            <span
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2"
              style={{
                background: "var(--tint, #007aff)",
                borderColor: "var(--bg, #fff)",
                color: "#fff",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m7 12 3 3 7-7" />
              </svg>
            </span>
          </div>

          <div
            className="mb-1.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold tracking-[.11em]"
            style={{
              background: "var(--card, #f2f2f7)",
              color: "var(--tint, #007aff)",
            }}
          >
            {copy.eyebrow}
          </div>

          <h2
            id="product-update-title"
            className="m-0 text-[20px] font-bold tracking-[-.025em]"
          >
            {copy.title}
          </h2>

          <p
            className="mx-auto mb-0 mt-1.5 max-w-[280px] text-[13px] leading-[1.45]"
            style={{
              color: "var(--meta, #8e8e93)",
            }}
          >
            {copy.description}
          </p>
        </div>

        <div
          className="mx-4 mb-4 overflow-hidden rounded-[14px]"
          style={{
            background: "var(--card, #f2f2f7)",
          }}
        >
          <CompactRow
            icon="important"
            title={copy.importantTitle}
            body={copy.importantBody}
            first
          />

          <CompactRow
            icon="all"
            title={copy.allTitle}
            body={copy.allBody}
          />

          <CompactRow
            icon="settings"
            title={copy.settingsTitle}
            body={copy.settingsBody}
          />
        </div>

        <button
          type="button"
          autoFocus
          className="w-full cursor-pointer border-x-0 border-b-0 bg-transparent py-[13px] text-[15px] font-semibold"
          style={{
            borderTop:
              "0.5px solid var(--hairline, rgba(60,60,67,.22))",
            color: "var(--tint, #007aff)",
            fontFamily: "inherit",
          }}
          onClick={() => {
            setVisible(false);
          }}
        >
          {copy.confirm}
        </button>
      </section>
    </div>
  );
}

type RowIcon = "important" | "all" | "settings";

function CompactRow({
  icon,
  title,
  body,
  first = false,
}: {
  icon: RowIcon;
  title: string;
  body: string;
  first?: boolean;
}) {
  return (
    <div
      className="flex items-start gap-2.5 px-3.5 py-2.5"
      style={{
        borderTop: first
          ? "none"
          : "0.5px solid var(--hairline, rgba(60,60,67,.18))",
      }}
    >
      <span
        className="mt-[1px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full"
        style={{
          background:
            "color-mix(in srgb, var(--tint, #007aff) 12%, transparent)",
          color: "var(--tint, #007aff)",
        }}
        aria-hidden="true"
      >
        <RowIconSvg icon={icon} />
      </span>

      <span className="min-w-0 text-left">
        <strong
          className="block text-[12.5px] font-semibold leading-[1.3]"
          style={{
            color: "var(--gray-text, #111)",
          }}
        >
          {title}
        </strong>

        <span
          className="mt-0.5 block text-[11.5px] leading-[1.4]"
          style={{
            color: "var(--secondary-text, #636366)",
          }}
        >
          {body}
        </span>
      </span>
    </div>
  );
}

function RowIconSvg({ icon }: { icon: RowIcon }) {
  if (icon === "important") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 17h12" />
        <path d="M8 17v-6a4 4 0 0 1 8 0v6" />
        <path d="M10 20h4" />
      </svg>
    );
  }

  if (icon === "all") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 5h16v11H9l-5 4V5Z" />
        <path d="M8 9h8" />
        <path d="M8 12h5" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />
    </svg>
  );
}