export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  ALLOWED_ORIGIN: string;
  INTERNAL_SECRET: string;
}
