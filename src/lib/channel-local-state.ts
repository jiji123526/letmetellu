const channelLocalStorageKeys = (channelId: string) => [
  `roomToken_${channelId}`,
  `bannedWords_${channelId}`,
  `liveEmojis_${channelId}_live`,
  `bubbleColor_${channelId}`,
  `liveActive_${channelId}`,
  `inLiveMode_${channelId}`,
  `liveTitle_${channelId}`,
  `liveSession_${channelId}`,
  `activeNotice_${channelId}`,
  `liveSeen_${channelId}`,
  `noticeDismissed_${channelId}`,
  `noticeDismissed_${channelId}_live`,
  `welcomeConfig_${channelId}`,
  `welcome_seen_${channelId}`,
  `channelInstance_${channelId}`,
];

export function clearChannelLocalState(channelId: string) {
  if (typeof window === "undefined") return;
  channelLocalStorageKeys(channelId).forEach((key) => localStorage.removeItem(key));
  window.dispatchEvent(new CustomEvent("room-token-changed", {
    detail: { channelId, token: null },
  }));
}

export function syncChannelInstance(channelId: string, instanceId?: string | null) {
  if (typeof window === "undefined" || !instanceId) return false;
  const key = `channelInstance_${channelId}`;
  const previous = localStorage.getItem(key);
  if (previous && previous !== instanceId) {
    clearChannelLocalState(channelId);
  }
  localStorage.setItem(key, instanceId);
  return Boolean(previous && previous !== instanceId);
}
