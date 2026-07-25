"use client";

import { useState, useRef } from "react";
import { verifyPasscode, setRoomToken } from "@/lib/api";
import { useLocale } from "@/hooks/useLocale";

interface PasscodeOverlayProps {
  channelId: string;
  channelName: string;
  profileImage: string | null;
  bubbleColor: string;
  passcodeHint?: string;
  notice?: string;
  onSuccess: () => void;
}

export function PasscodeOverlay({ channelId, channelName, profileImage, bubbleColor, passcodeHint, notice, onSuccess }: PasscodeOverlayProps) {
  const { t } = useLocale();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!passcode.trim()) return;
    setError("");
    setLoading(true);

    const result = await verifyPasscode(channelId, passcode);

    if (result.token) {
      setRoomToken(channelId, result.token);
      onSuccess();
    } else {
      setShake(true);
      setError(t("wrongPasscode"));
      setTimeout(() => setShake(false), 500);
      setPasscode("");
      inputRef.current?.focus();
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "var(--bg)", padding: "24px" }}
    >
      <div
        className={`w-full max-w-[300px] text-center ${shake ? "animate-[shake_0.3s_ease]" : ""}`}
      >
        {/* Channel profile */}
        <div
          className="mx-auto rounded-full overflow-hidden"
          style={{ width: "80px", height: "80px", marginBottom: "16px" }}
        >
          {profileImage ? (
            <img src={profileImage} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl" style={{ background: "var(--gray-bubble)" }}>💬</div>
          )}
        </div>

        {/* Channel name */}
        <div style={{ fontSize: "calc(var(--bubble-font-size) + 2px)", fontWeight: 500, color: "var(--gray-text)", marginBottom: "8px" }}>
          {channelName}
        </div>

        {/* Description */}
        <div style={{ fontSize: "calc(var(--bubble-font-size) - 3px)", color: "var(--meta)", marginBottom: "24px" }}>
          {t("passcodeRequired")}
        </div>

        {passcodeHint && (
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 3px)", color: "var(--gray-text)", background: "var(--gray-bubble)", borderRadius: "10px", padding: "10px 12px", marginBottom: "12px", overflowWrap: "anywhere" }}>
            <span style={{ color: "var(--meta)" }}>{t("passcodeHintLabel")}: </span>
            {passcodeHint}
          </div>
        )}

        {notice && (
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", color: "#d32f2f", marginBottom: "12px" }}>
            {notice}
          </div>
        )}

        {/* Input */}
        <input
          ref={inputRef}
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSubmit(); }}
          placeholder={t("passcodeInput")}
          autoFocus
          style={{
            width: "100%",
            padding: "12px 16px",
            border: `2px solid ${error ? "#d32f2f" : "var(--input-border)"}`,
            borderRadius: "12px",
            fontSize: "var(--bubble-font-size)",
            fontFamily: "inherit",
            background: "var(--input-bg)",
            color: "var(--gray-text)",
            outline: "none",
            textAlign: "center",
            boxSizing: "border-box",
            transition: "border-color .2s",
          }}
          onFocus={(e) => { if (!error) (e.target as HTMLInputElement).style.borderColor = bubbleColor; }}
          onBlur={(e) => { if (!error) (e.target as HTMLInputElement).style.borderColor = "var(--input-border)"; }}
        />

        {/* Error */}
        {error && (
          <div style={{ fontSize: "calc(var(--bubble-font-size) - 4px)", color: "#d32f2f", marginTop: "8px" }}>
            {error}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={loading || !passcode.trim()}
          style={{
            width: "100%",
            marginTop: "16px",
            padding: "12px",
            border: "none",
            borderRadius: "12px",
            background: bubbleColor,
            color: "#fff",
            fontSize: "var(--bubble-font-size)",
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: loading ? "wait" : "pointer",
            opacity: loading || !passcode.trim() ? 0.6 : 1,
            lineHeight: 1,
          }}
        >
          {loading ? "..." : t("enterChannel")}
        </button>
      </div>
    </div>
  );
}
