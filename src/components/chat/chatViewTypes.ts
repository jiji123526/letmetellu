import type { Message, MessagePageCursor } from "./chatTypes";
import type { ViewerPlanState } from "@/lib/owner-plan";
import type {
  ChatTimelineItem,
  UnifiedTimelineCursor,
} from "./chatTimelineState";

export interface UnifiedTimelineBootstrap {
  contract_version: 1;
  items: ChatTimelineItem[];
  has_more: boolean;
  page_start_cursor: UnifiedTimelineCursor | null;
  page_end_cursor: UnifiedTimelineCursor | null;
}

export interface Channel {
  id: string;
  owner_uid: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  is_frozen: number;
  notice: string;
  passcode_hint?: string | null;
  owner_name?: string | null;
  owner_channel_count?: number;
  instance_id?: string | null;
  appearance_version?: string | null;
  show_on_profile?: number;
  background_type?: "default" | "color" | "image";
  background_color?: string | null;
  background_image?: string | null;
  background_overlay?: number;
  background_blur?: number;
}

export interface InitData {
  channel: Channel;
  messages?: Message[];
  page_start_cursor?: MessagePageCursor | null;
  page_end_cursor?: MessagePageCursor | null;
  blocked?: { uid: string; reason: string }[];
  viewerBlocked?: boolean;
  viewerModerationStatus?: "frozen" | null;
  dm?: Message[];
  bannerNotice?: string;
  welcomeConfig?: string;
  live?: { active: boolean; title?: string; sessionId?: string; startedAt?: string; expiresAt?: string } | null;
  emojiPresets?: string | null;
  petitionEnabled?: boolean;
  dmEnabled?: boolean;
  hasPasscode?: boolean;
  passcodeHint?: string;
  adminDataStatus?: "authorized" | "unauthorized";
  anonymousUid?: string;
  viewerAccess?: "owner" | "reports_owner" | "standard";
  viewerPlan?: ViewerPlanState;
  isReportsChannel?: boolean;
  unifiedTimelineEnabled?: boolean;
  unifiedTimeline?: UnifiedTimelineBootstrap;
  ownerModeration?: {
    status: "active" | "warned" | "suspended" | "frozen";
    petitionStatus: "none" | "open" | "accepted" | "rejected";
  };
}

export interface PasscodeGateState {
  name: string;
  profile_image: string | null;
  bubble_color: string;
  passcodeHint?: string;
  notice?: string;
}
