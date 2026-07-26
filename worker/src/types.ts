export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  ALLOWED_ORIGIN: string;
  INTERNAL_SECRET: string;
  RESEND_API_KEY: string;
  EMAIL_TEST_RECIPIENT: string;
  APP_ORIGIN: string;
}
