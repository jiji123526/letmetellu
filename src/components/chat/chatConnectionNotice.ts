interface ReconnectNoticeContext {
  reconnectPending: boolean;
  historyMode: "latest" | "context";
  isNearBottom: boolean;
  inLiveMode: boolean;
  dmMode: boolean;
}

export function shouldShowReconnectNotice({
  reconnectPending,
  inLiveMode,
  dmMode,
}: ReconnectNoticeContext): boolean {
  if (!reconnectPending) return false;
  return inLiveMode || dmMode;
}
