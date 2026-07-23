// Mock API for local development — no Worker needed
// Set NEXT_PUBLIC_MOCK=true in .env.local to enable

const MOCK_CHANNEL = {
  id: "test",
  owner_uid: "owner-001",
  name: "Test Channel",
  profile_image: null,
  bubble_color: "#3b8df0",
  passcode: null,
  notice: JSON.stringify([{ title: "채널 규칙", items: ["서로 존중해주세요", "광고/스팸 금지", "개인정보 공유 금지"] }]),
  is_frozen: 0,
  created_at: "2026-01-01 00:00:00",
};

interface MockMessage {
  id: string;
  uid: string;
  nick: string | null;
  text: string;
  is_admin: number;
  image: string | null;
  reactions: string;
  reply_to: string | null;
  created_at: string;
}

const MOCK_MESSAGES: MockMessage[] = [
  { id: "1", uid: "user-a", nick: null, text: "안녕하세요!", is_admin: 0, image: null, reactions: "{}", reply_to: null, created_at: "2026-07-23T10:00:00" },
  { id: "2", uid: "user-b", nick: null, text: "반갑습니다 ㅎㅎ", is_admin: 0, image: null, reactions: JSON.stringify({ "user-a_1": "👍", "user-b_1": "👍" }), reply_to: null, created_at: "2026-07-23T10:00:30" },
  { id: "3", uid: "user-a", nick: null, text: "여기 처음이에요", is_admin: 0, image: null, reactions: "{}", reply_to: null, created_at: "2026-07-23T10:01:00" },
  { id: "4", uid: "owner-001", nick: null, text: "환영합니다! 편하게 대화해요 🙌", is_admin: 1, image: null, reactions: JSON.stringify({ "user-a_2": "🫪", "user-b_2": "👍" }), reply_to: null, created_at: "2026-07-23T10:01:30" },
  { id: "5", uid: "user-b", nick: null, text: "오 여기 분위기 좋다", is_admin: 0, image: null, reactions: "{}", reply_to: "4", created_at: "2026-07-23T10:02:00" },
  { id: "6", uid: "user-a", nick: null, text: "ㅋㅋㅋ 맞아요 아늑한 느낌", is_admin: 0, image: null, reactions: "{}", reply_to: "4", created_at: "2026-07-23T10:02:20" },
  { id: "7", uid: "user-a", nick: null, text: "오늘 뭐해요 다들?", is_admin: 0, image: null, reactions: "{}", reply_to: null, created_at: "2026-07-23T10:03:00" },
  { id: "8", uid: "owner-001", nick: null, text: "저는 코딩 중이에요 ㅎㅎ 새로운 기능 추가하는 중!", is_admin: 1, image: null, reactions: "{}", reply_to: "7", created_at: "2026-07-23T10:03:30" },
  { id: "9", uid: "user-c", nick: null, text: "이 메시지를 신고해보세요 👀", is_admin: 0, image: null, reactions: "{}", reply_to: null, created_at: "2026-07-23T10:04:00" },
];

let mockMessages: MockMessage[] = [...MOCK_MESSAGES];

export async function fetchInit(_channelId: string) {
  return {
    channel: MOCK_CHANNEL,
    messages: mockMessages,
    blocked: [],
    presence: 3,
  };
}

export async function fetchMessages(_channelId: string, _cursor?: string) {
  return { messages: mockMessages };
}

export async function sendMessage(payload: {
  uid: string;
  nick?: string;
  text: string;
  channel_id: string;
  image?: string;
  reply_to?: string;
  fingerprint?: string;
}) {
  const msg = {
    id: crypto.randomUUID(),
    uid: payload.uid,
    nick: payload.nick || null,
    text: payload.text,
    is_admin: 0,
    image: payload.image || null,
    reactions: "{}",
    reply_to: payload.reply_to || null,
    created_at: new Date().toISOString(),
  };
  mockMessages = [...mockMessages, msg];
  return msg;
}

export async function adminAction(
  _action: string,
  _channelId: string,
  _payload?: Record<string, unknown>
) {
  return { ok: true };
}

export function getWebSocketUrl(_channelId: string, _uid: string): string {
  return "";
}
