import { ImageResponse } from "next/og";

export const alt = "yap. — 링크 하나로 시작하는 익명 채팅";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function LinkIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#ffffff",
          color: "#111111",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 620,
            height: 620,
            borderRadius: 999,
            right: -210,
            top: -330,
            background: "#007AFF",
            opacity: 0.09,
          }}
        />
        <div
          style={{
            width: 650,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "74px 0 74px 86px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", color: "#007AFF", fontSize: 62, fontWeight: 800, letterSpacing: -3 }}>
            yap.
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 54, fontSize: 58, fontWeight: 750, lineHeight: 1.18, letterSpacing: -3 }}>
            <span>링크 하나로 시작하는</span>
            <span>익명 채팅</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 42, color: "#6e6e73", fontSize: 27, fontWeight: 500 }}>
            <span style={{ display: "flex", color: "#007AFF", marginRight: 14 }}><LinkIcon /></span>
            로그인 없이 바로 대화하고, 필요한 만큼 관리해요.
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 48 }}>
            <span style={{ padding: "8px 15px", borderRadius: 999, background: "#f2f2f7", color: "#6e6e73", fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>BETA</span>
            <span style={{ marginLeft: 18, color: "#8e8e93", fontSize: 23 }}>yapndot.com</span>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", paddingRight: 74 }}>
          <div
            style={{
              width: 390,
              height: 500,
              display: "flex",
              flexDirection: "column",
              padding: "34px 28px",
              borderRadius: 48,
              background: "#f7f7f9",
              border: "1px solid #e5e5ea",
              boxShadow: "0 24px 70px rgba(0,0,0,0.13)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", color: "#111111", fontSize: 25, fontWeight: 700 }}>yap.</div>
            <div style={{ height: 1, background: "#dedee3", margin: "24px -28px 26px" }} />
            <div style={{ display: "flex", alignSelf: "flex-start", maxWidth: 250, padding: "15px 20px", borderRadius: "22px 22px 22px 7px", background: "#e9e9ed", fontSize: 22 }}>
              링크 잘 들어왔어?
            </div>
            <div style={{ display: "flex", alignSelf: "flex-end", maxWidth: 276, marginTop: 12, padding: "15px 20px", borderRadius: "22px 22px 7px 22px", background: "#3598fe", color: "#ffffff", fontSize: 22 }}>
              응, 로그인 없이 바로 됐어
            </div>
            <div style={{ display: "flex", alignSelf: "flex-start", maxWidth: 290, marginTop: 12, padding: "15px 20px", borderRadius: "22px 22px 22px 7px", background: "#e9e9ed", fontSize: 22 }}>
              여기서 편하게 얘기하자
            </div>
            <div style={{ display: "flex", alignItems: "center", marginTop: "auto", padding: "14px 18px", borderRadius: 22, background: "#ffffff", border: "1px solid #dedee3", color: "#8e8e93", fontSize: 20 }}>
              메시지
              <span style={{ display: "flex", marginLeft: "auto", width: 30, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "#007AFF", color: "white", fontSize: 18 }}>↑</span>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
