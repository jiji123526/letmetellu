export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  ALLOWED_ORIGIN: string;
  INTERNAL_SECRET: string;
  RESEND_API_KEY: string;
  OPERATIONAL_ALERT_EMAIL?: string;
  APP_ORIGIN: string;
  REPORTS_CHANNEL_ID?: string;
}
