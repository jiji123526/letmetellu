"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { decorateMediaUrl, decorateProtectedMediaUrl, decorateWelcomeConfig } from "@/lib/api-core";
import { adminAction } from "@/lib/api-chat";
import { updateRecentChannelAppearance } from "@/lib/recent-channels";
import { setAccountChannelColor } from "@/lib/account-recent-channels";
import { getChannelAppearanceVersion } from "@/lib/channel-appearance";
import { patchChannelAppearance } from "@/lib/channel-background-cache";

interface BannerState {
  text: string;
  color: string;
}

interface BackgroundUpdate {
  background_type?: "default" | "color" | "image";
  background_color?: string | null;
  background_image?: string | null;
  background_overlay?: number;
  background_blur?: number;
}

interface ChannelSettingsState {
  name: string;
  profile_image: string | null;
  bubble_color: string;
  appearance_version?: string | null;
  notice: string;
  passcode_hint?: string | null;
  show_on_profile?: number;
  background_type?: "default" | "color" | "image";
  background_color?: string | null;
  background_image?: string | null;
  background_overlay?: number;
  background_blur?: number;
}

interface UseChatChannelSettingsArgs<TChannel extends ChannelSettingsState> {
  channelId: string;
  channel: TChannel | null;
  bubbleColor: string;
  inLiveMode: boolean;
  isLoggedIn: boolean;
  personalBubbleColorEnabled: boolean;
  petitionEnabled: boolean;
  dmEnabled: boolean;
  setAdminViewAsUser: Dispatch<SetStateAction<boolean>>;
  setPetitionEnabled: Dispatch<SetStateAction<boolean>>;
  setDmEnabled: Dispatch<SetStateAction<boolean>>;
  setActiveNotice: Dispatch<SetStateAction<string>>;
  setWelcomeConfig: Dispatch<SetStateAction<string>>;
  setBlockedUsers: Dispatch<SetStateAction<{ uid: string; reason: string }[]>>;
  setLocalBubbleColor: Dispatch<SetStateAction<string | null>>;
  setChannel: Dispatch<SetStateAction<TChannel | null>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  text: {
    petitionAllowed: string;
    petitionBlocked: string;
    dmAllowed: string;
    dmBlocked: string;
    channelShownOnProfile: string;
    channelHiddenFromProfile: string;
    backgroundChanged: string;
    plusRequiredCustomization: string;
    nameChanged: string;
    profileChanged: string;
    rulesChanged: string;
    welcomeChanged: string;
    chatUnfrozen: string;
    noticePosted: string;
  };
}

export interface UseChatChannelSettingsResult {
  handleViewerColorChange: (color: string) => void;
  handleToggleView: () => void;
  handlePetitionToggle: () => void;
  handleDmToggle: () => void;
  handleShowOnProfileToggle: (visible: boolean) => void;
  handleColorChange: (color: string) => void;
  handleBackgroundChange: (background: BackgroundUpdate) => void;
  handleNameChange: (name: string) => void;
  handleProfileImageChange: (url: string) => void;
  handlePasscodeChange: (hasPasscode: boolean, hint?: string) => void;
  handleNoticeChange: (noticeStr: string) => void;
  handleWelcomeChange: (config: string) => void;
  handleUnblock: (blockedUid: string) => void;
  handleNoticeEditSave: (title: string, body: string) => void;
}

export function useChatChannelSettings<TChannel extends ChannelSettingsState>({
  channelId,
  channel,
  bubbleColor,
  inLiveMode,
  isLoggedIn,
  personalBubbleColorEnabled,
  petitionEnabled,
  dmEnabled,
  setAdminViewAsUser,
  setPetitionEnabled,
  setDmEnabled,
  setActiveNotice,
  setWelcomeConfig,
  setBlockedUsers,
  setLocalBubbleColor,
  setChannel,
  setBanner,
  text,
}: UseChatChannelSettingsArgs<TChannel>): UseChatChannelSettingsResult {
  const flashBanner = useCallback((message: string, color: string, durationMs = 3000) => {
    setBanner({ text: message, color });
    setTimeout(() => setBanner(null), durationMs);
  }, [setBanner]);

  const handleToggleView = useCallback(() => {
    setAdminViewAsUser(true);
  }, [setAdminViewAsUser]);

  const handleViewerColorChange = useCallback((color: string) => {
    if (!personalBubbleColorEnabled) return;
    setLocalBubbleColor(color);
    localStorage.setItem(`bubbleColor_${channelId}`, color);
    if (isLoggedIn) {
      void setAccountChannelColor(channelId, color).catch(() => {
        // Keep the selected color locally and retry on the next change.
      });
    } else {
      updateRecentChannelAppearance(channelId, { bubbleColor: color });
    }
  }, [channelId, isLoggedIn, personalBubbleColorEnabled, setLocalBubbleColor]);

  const handlePetitionToggle = useCallback(() => {
    const nextValue = !petitionEnabled;
    setPetitionEnabled(nextValue);
    adminAction("set-petition", channelId, { enabled: nextValue });
    flashBanner(nextValue ? text.petitionAllowed : text.petitionBlocked, nextValue ? "#2a9d4e" : "#c0392b");
  }, [channelId, flashBanner, petitionEnabled, setPetitionEnabled, text.petitionAllowed, text.petitionBlocked]);

  const handleDmToggle = useCallback(() => {
    const nextValue = !dmEnabled;
    setDmEnabled(nextValue);
    adminAction("set-dm", channelId, { enabled: nextValue });
    flashBanner(nextValue ? text.dmAllowed : text.dmBlocked, nextValue ? "#2a9d4e" : "#c0392b");
  }, [channelId, dmEnabled, flashBanner, setDmEnabled, text.dmAllowed, text.dmBlocked]);

  const handleShowOnProfileToggle = useCallback((visible: boolean) => {
    setChannel((previous) => previous ? { ...previous, show_on_profile: visible ? 1 : 0 } : null);
    adminAction("update-profile", channelId, { show_on_profile: visible });
    flashBanner(visible ? text.channelShownOnProfile : text.channelHiddenFromProfile, bubbleColor, 2500);
  }, [bubbleColor, channelId, flashBanner, setChannel, text.channelHiddenFromProfile, text.channelShownOnProfile]);

  const handleColorChange = useCallback(async (color: string) => {
    const result = await adminAction("update-profile", channelId, { bubble_color: color }) as {
      ok?: boolean;
      error?: string;
      _status?: number;
    };
    if (result?.error === "plus_required" || result?._status === 403) {
      flashBanner(text.plusRequiredCustomization, "#d32f2f");
      return;
    }
    if (!result?.ok && (result?._status || 200) >= 400) {
      return;
    }

    const nextAppearance = {
      bubble_color: color,
      background_type: channel?.background_type,
      background_color: channel?.background_color,
      background_image: channel?.background_image,
      background_overlay: channel?.background_overlay,
      background_blur: channel?.background_blur,
    };
    const appearanceVersion = getChannelAppearanceVersion(nextAppearance);
    setLocalBubbleColor(color);
    setChannel((previous) => previous ? {
      ...previous,
      bubble_color: color,
      appearance_version: appearanceVersion,
    } : null);
    localStorage.setItem(`bubbleColor_${channelId}`, color);
    document.documentElement.style.setProperty("--bubble-sent", color);
    patchChannelAppearance(channelId, {
      ...nextAppearance,
      appearance_version: appearanceVersion,
    });
    if (isLoggedIn) {
      void setAccountChannelColor(channelId, color).catch(() => {
        // Channel color still updates even if personal sync is temporarily unavailable.
      });
    } else {
      updateRecentChannelAppearance(channelId, { bubbleColor: color });
    }
  }, [
    channel,
    channelId,
    flashBanner,
    isLoggedIn,
    setChannel,
    setLocalBubbleColor,
    text.plusRequiredCustomization,
  ]);

  const handleBackgroundChange = useCallback(async (background: BackgroundUpdate) => {
    const result = await adminAction("update-profile", channelId, background as Record<string, unknown>) as {
      ok?: boolean;
      error?: string;
      _status?: number;
    };
    if (result?.error === "plus_required" || result?._status === 403) {
      flashBanner(text.plusRequiredCustomization, "#d32f2f");
      return;
    }
    if (!result?.ok && (result?._status || 200) >= 400) {
      return;
    }

    const decoratedBackgroundImage = decorateProtectedMediaUrl(background.background_image) || background.background_image;
    const nextAppearance = {
      bubble_color: channel?.bubble_color,
      background_type: background.background_type ?? channel?.background_type,
      background_color: background.background_color !== undefined
        ? background.background_color
        : channel?.background_color,
      background_image: decoratedBackgroundImage !== undefined
        ? decoratedBackgroundImage
        : channel?.background_image,
      background_overlay: background.background_overlay ?? channel?.background_overlay,
      background_blur: background.background_blur ?? channel?.background_blur,
    };
    const appearanceVersion = getChannelAppearanceVersion(nextAppearance);
    setChannel((previous) => previous ? {
      ...previous,
      ...background,
      background_image: decoratedBackgroundImage,
      appearance_version: appearanceVersion,
    } : null);
    patchChannelAppearance(channelId, {
      ...background,
      background_image: decoratedBackgroundImage,
      appearance_version: appearanceVersion,
    });
    flashBanner(text.backgroundChanged, bubbleColor, 2500);
  }, [
    bubbleColor,
    channel,
    channelId,
    flashBanner,
    setChannel,
    text.backgroundChanged,
    text.plusRequiredCustomization,
  ]);

  const handleNameChange = useCallback((name: string) => {
    setChannel((previous) => previous ? { ...previous, name } : null);
    updateRecentChannelAppearance(channelId, { name });
    adminAction("update-profile", channelId, { name });
    flashBanner(text.nameChanged, bubbleColor);
  }, [bubbleColor, channelId, flashBanner, setChannel, text.nameChanged]);

  const handleProfileImageChange = useCallback((url: string) => {
    const decoratedUrl = decorateMediaUrl(url) || url;
    setChannel((previous) => previous ? { ...previous, profile_image: decoratedUrl } : null);
    updateRecentChannelAppearance(channelId, { profileImage: decoratedUrl });
    adminAction("update-profile", channelId, { profile_image: url });
    flashBanner(text.profileChanged, bubbleColor);
  }, [bubbleColor, channelId, flashBanner, setChannel, text.profileChanged]);

  const handlePasscodeChange = useCallback((hasPasscode: boolean, hint?: string) => {
    setChannel((previous) => previous ? { ...previous, passcode_hint: hasPasscode ? hint || null : null } : null);
    updateRecentChannelAppearance(channelId, { hasPasscode });
  }, [channelId, setChannel]);

  const handleNoticeChange = useCallback((noticeStr: string) => {
    setChannel((previous) => previous ? { ...previous, notice: noticeStr } : null);
    adminAction("set-rules", channelId, { rules: noticeStr });
    flashBanner(text.rulesChanged, bubbleColor);
  }, [bubbleColor, channelId, flashBanner, setChannel, text.rulesChanged]);

  const handleWelcomeChange = useCallback((config: string) => {
    const decoratedConfig = decorateWelcomeConfig(config) || config;
    setWelcomeConfig(decoratedConfig);
    localStorage.setItem(`welcomeConfig_${channelId}`, decoratedConfig);
    adminAction("set-welcome", channelId, { config });
    flashBanner(text.welcomeChanged, bubbleColor);
  }, [bubbleColor, channelId, flashBanner, setWelcomeConfig, text.welcomeChanged]);

  const handleUnblock = useCallback((blockedUid: string) => {
    adminAction("unblock", channelId, { uid: blockedUid });
    setBlockedUsers((previous) => previous.filter((blockedUser) => blockedUser.uid !== blockedUid));
    flashBanner(text.chatUnfrozen, "#2a9d4e");
  }, [channelId, flashBanner, setBlockedUsers, text.chatUnfrozen]);

  const handleNoticeEditSave = useCallback((title: string, body: string) => {
    if (!title) {
      setActiveNotice("");
      localStorage.removeItem(`activeNotice_${channelId}`);
      adminAction("set-notice", inLiveMode ? `${channelId}_live` : channelId, { text: "" });
      flashBanner(text.noticePosted, "var(--meta)");
      return;
    }

    const notice = body ? JSON.stringify({ title, body }) : title;
    setActiveNotice(notice);
    localStorage.setItem(`activeNotice_${channelId}`, notice);
    localStorage.removeItem(`noticeDismissed_${channelId}`);
    adminAction("set-notice", inLiveMode ? `${channelId}_live` : channelId, { text: notice });
    flashBanner(text.noticePosted, bubbleColor);
  }, [bubbleColor, channelId, flashBanner, inLiveMode, setActiveNotice, text.noticePosted]);

  return {
    handleViewerColorChange,
    handleToggleView,
    handlePetitionToggle,
    handleDmToggle,
    handleShowOnProfileToggle,
    handleColorChange,
    handleBackgroundChange,
    handleNameChange,
    handleProfileImageChange,
    handlePasscodeChange,
    handleNoticeChange,
    handleWelcomeChange,
    handleUnblock,
    handleNoticeEditSave,
  };
}
