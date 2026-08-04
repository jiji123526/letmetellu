import { getPublicChannelPreview } from "@/lib/channel-preview";
import { ImageResponse } from "next/og";

export const alt = "yap. channel preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

function LockIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default async function OpenGraphImage({ params }: Props) {
  const { slug } = await params;
  const channel = await getPublicChannelPreview(slug);
  const name = channel?.name || "yap.";
  const color = channel?.bubbleColor || "#3b8df0";
  const initial = name.slice(0, 1).toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          background: "#f5f5f7",
          color: "#111111",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 560,
            height: 560,
            borderRadius: 999,
            top: -310,
            right: -130,
            background: color,
            opacity: 0.12,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: 999,
            bottom: -270,
            left: -120,
            background: color,
            opacity: 0.1,
          }}
        />
        <div
          style={{
            width: 1040,
            height: 470,
            display: "flex",
            alignItems: "center",
            padding: "64px 76px",
            borderRadius: 56,
            background: "rgba(255,255,255,0.92)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.10)",
          }}
        >
          <div
            style={{
              width: 280,
              height: 280,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              borderRadius: 999,
              background: color,
              color: "white",
              fontSize: 116,
              fontWeight: 700,
              boxShadow: `0 0 0 12px ${color}22`,
            }}
          >
            {channel?.profileImage ? (
              <img
                src={channel.profileImage}
                width="280"
                height="280"
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : initial}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 64, flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", color }}>
              <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>yap.</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", marginTop: 28 }}>
              <span style={{ fontSize: name.length > 18 ? 54 : 68, fontWeight: 700, letterSpacing: -2, lineHeight: 1.08 }}>
                {name}
              </span>
              {channel?.hasPasscode ? (
                <span style={{ display: "flex", marginLeft: 20, color: "#6e6e73" }}><LockIcon /></span>
              ) : null}
            </div>
            <span style={{ marginTop: 22, color: "#6e6e73", fontSize: 30, fontWeight: 500 }}>
              링크로 이어지는 익명 채팅
            </span>
            <span style={{ marginTop: 18, color: "#8e8e93", fontSize: 23 }}>
              yapndot.com/ch/{slug}
            </span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
