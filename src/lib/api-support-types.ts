export type SupportNodeKind = "choice" | "text" | "escalate" | "terminal";
export type SupportSessionStatus = "open" | "resolved" | "escalated" | "abandoned";
export type SupportThreadStatus = "open" | "closed";

export interface SupportChoice {
  id: string;
  label: string;
  next: string;
  topic?: string;
}

export interface SupportNodeState {
  id: string;
  kind: SupportNodeKind;
  messages: string[];
  choices: SupportChoice[];
  placeholder: string;
  submitLabel: string;
  escalationLabel: string;
  resolution: "resolved" | "needs_handoff" | null;
}

export interface SupportSessionState {
  id: string;
  status: SupportSessionStatus;
  entry_topic: string | null;
  entry_topic_label: string;
  current_node_id: string;
  resolved_via_tree: boolean;
  escalated_thread_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SupportThreadState {
  id: string;
  user_id: string;
  source_session_id: string | null;
  entry_topic: string | null;
  entry_topic_label: string;
  summary: string;
  status: SupportThreadStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
  requires_user_acknowledgement: boolean;
  user_name: string | null;
  user_email: string | null;
  last_message: string | null;
  has_admin_reply: boolean;
  can_user_send: boolean;
  actor_type: "guest" | "logged_in";
  waiting_on: "user" | "platform_admin" | null;
  last_action: "ticket_created" | "user_replied" | "admin_replied" | "user_closed" | "admin_closed";
  unread_for_user: boolean;
  unread_for_admin: boolean;
  stale_level: "none" | "stale" | "critical";
  open_duration_minutes: number;
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  sender_role: "user" | "platform_admin";
  sender_user_id: string | null;
  text: string;
  created_at: string;
}

export interface SupportTranscriptEvent {
  id: string;
  event_type: "bot_message" | "user_choice" | "user_text" | "escalation";
  node_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SupportStateResponse {
  error?: string;
  platformAdmin?: boolean;
  thread: SupportThreadState | null;
  messages: SupportMessage[];
  session: SupportSessionState | null;
  transcript: SupportTranscriptEvent[];
  currentNode: SupportNodeState | null;
}

export interface SupportPreviewResponse {
  error?: string;
  thread: SupportThreadState | null;
}

export interface PlatformSupportThreadResponse {
  error?: string;
  thread: SupportThreadState | null;
  messages: SupportMessage[];
}

export interface PlatformSupportSessionResponse {
  error?: string;
  session: SupportSessionState | null;
  transcript: SupportTranscriptEvent[];
  currentNode: SupportNodeState | null;
}

export interface PlatformDashboardReportsInbox {
  channel_id: string;
  name: string;
  profile_image: string | null;
  bubble_color: string;
  open_report_count: number;
  oldest_report_at: string | null;
  created_at: string;
}

export interface PlatformDashboardTicketPreview extends SupportThreadState {
  user_label: string;
  has_admin_reply: boolean;
}

export interface PlatformDashboardSupportStats {
  open_count: number;
  waiting_for_admin_count: number;
  waiting_for_user_count: number;
  unread_for_admin_count: number;
  stale_24h_count: number;
  stale_72h_count: number;
  oldest_open_duration_minutes: number;
}

export interface PlatformDashboardResponse {
  error?: string;
  reportsInbox: PlatformDashboardReportsInbox | null;
  tickets: PlatformDashboardTicketPreview[];
  open_pagination?: {
    has_more: boolean;
    next_cursor: string | null;
  } | null;
  support_stats?: PlatformDashboardSupportStats | null;
}

export interface PlatformDashboardVersionResponse {
  error?: string;
  version: string;
}

export interface PlatformOperationalHealthWindow {
  tracked_event_count: number;
  request_5xx_count: number;
  preview_upstream_failure_count: number;
  unhandled_exception_count: number;
  maintenance_failure_count: number;
  rate_limited_count: number;
  forbidden_count: number;
  media_not_found_count: number;
}

export interface PlatformOperationalHealthRoute extends PlatformOperationalHealthWindow {
  route: string;
  last_event_at: string;
}

export interface PlatformOperationalHealthResponse {
  error?: string;
  generated_at: string;
  status: "healthy" | "degraded" | "critical";
  windows: {
    last_15m: PlatformOperationalHealthWindow;
    last_24h: PlatformOperationalHealthWindow;
  };
  routes: PlatformOperationalHealthRoute[];
}

export interface StoredSupportTicketPreview {
  threadId: string;
  topicLabel: string;
  preview: string;
  updatedAt: string;
  unreadForUser?: boolean;
  waitingOn?: "user" | "platform_admin" | null;
  staleLevel?: "none" | "stale" | "critical";
}

export type SupportApiResult<T extends object> = T & { _status: number };
