interface ReconnectNoticeContext {
  reconnectPending: boolean;
  historyMode: "latest" | "context";
  isNearBottom: boolean;
  inLiveMode: boolean;
  dmMode: boolean;
}

export function shouldShowReconnectNotice({
  reconnectPending,
  historyMode,
  isNearBottom,
  inLiveMode,
  dmMode,
}: ReconnectNoticeContext): boolean {
  if (!reconnectPending) return false;
  if (inLiveMode || dmMode) return true;
  return historyMode === "latest" && isNearBottom;
}
