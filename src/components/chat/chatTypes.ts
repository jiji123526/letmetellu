export interface ReportMeta {
  report_id: string;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  reason: string;
  reason_label: string;
  status: "open" | "resolved" | "dismissed";
  details?: string | null;
  reporter_label: string;
  created_at: string;
  resolved_at?: string | null;
  resolution_note?: string | null;
  moderation_status: "active" | "warned" | "suspended" | "frozen";
  petition_status: "none" | "open" | "accepted" | "rejected";
}

export interface PetitionMeta {
  petition_id: string;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  owner_label: string;
  text: string;
  status: "open" | "accepted" | "rejected";
  created_at: string;
  resolved_at?: string | null;
  resolution_note?: string | null;
}

export interface Message {
  id: string;
  uid: string;
  auth_uid?: string | null;
  nick: string | null;
  text: string;
  is_admin: number;
  image: string | null;
  reactions: string;
  reply_to: string | null;
  created_at: string;
  channel_id?: string;
  dm?: boolean;
  deleted?: boolean;
  edited?: boolean;
  report?: number;
  reported_msg_id?: string;
  report_meta?: ReportMeta;
  petition_meta?: PetitionMeta;
  protected_sender?: boolean;
}
