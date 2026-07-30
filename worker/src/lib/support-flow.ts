import type { UserLocale } from "./channel-moderation";

export type SupportTopic =
  | "login"
  | "passcode"
  | "blocked"
  | "reports"
  | "live"
  | "billing"
  | "other";

type SupportNodeKind = "choice" | "text" | "escalate" | "terminal";

export interface SupportChoice {
  id: string;
  label: string;
  next: string;
  topic?: SupportTopic;
}

export interface SupportNode {
  id: string;
  kind: SupportNodeKind;
  messages: string[];
  choices?: SupportChoice[];
  placeholder?: string;
  submitLabel?: string;
  escalationLabel?: string;
  resolution?: "resolved" | "needs_handoff";
}

export interface SupportTranscriptEvent {
  id: string;
  event_type: "bot_message" | "user_choice" | "user_text" | "escalation";
  node_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

function t(locale: UserLocale, en: string, ko: string): string {
  return locale === "en" ? en : ko;
}

export function supportTopicLabel(topic: SupportTopic | string | null | undefined, locale: UserLocale): string {
  switch (topic) {
    case "login":
      return t(locale, "Login or account", "로그인 또는 계정");
    case "passcode":
      return t(locale, "Passcode or access", "비밀번호 또는 입장");
    case "blocked":
      return t(locale, "Blocked or frozen", "차단 또는 동결");
    case "reports":
      return t(locale, "Report or safety", "신고 또는 안전");
    case "live":
      return t(locale, "Live feature", "라이브 기능");
    case "billing":
      return t(locale, "Billing or payments", "결제 또는 유료 기능");
    case "other":
      return t(locale, "Other", "기타");
    default:
      return t(locale, "Support", "고객지원");
  }
}

export function getSupportNode(nodeId: string, locale: UserLocale): SupportNode | null {
  const nodes = buildSupportFlow(locale);
  return nodes[nodeId] || null;
}

export function buildSupportFlow(locale: UserLocale): Record<string, SupportNode> {
  const resolvedChoice: SupportChoice = {
    id: "resolved",
    label: t(locale, "That fixed it", "해결됐어요"),
    next: "resolved",
  };
  const needHelpChoice = (next: string): SupportChoice => ({
    id: `need-help-${next}`,
    label: t(locale, "I still need help", "아직 도움이 필요해요"),
    next,
  });

  return {
    start: {
      id: "start",
      kind: "choice",
      messages: [
        t(
          locale,
          "Tell me what you need help with first. I’ll try the quickest steps before I connect you to support.",
          "먼저 어떤 도움이 필요한지 알려주세요. 운영팀으로 넘기기 전에 빠르게 확인할 수 있는 방법부터 안내할게요.",
        ),
      ],
      choices: [
        { id: "topic-login", label: supportTopicLabel("login", locale), next: "login-steps", topic: "login" },
        { id: "topic-passcode", label: supportTopicLabel("passcode", locale), next: "passcode-steps", topic: "passcode" },
        { id: "topic-blocked", label: supportTopicLabel("blocked", locale), next: "blocked-steps", topic: "blocked" },
        { id: "topic-reports", label: supportTopicLabel("reports", locale), next: "reports-steps", topic: "reports" },
        { id: "topic-live", label: supportTopicLabel("live", locale), next: "live-steps", topic: "live" },
        { id: "topic-billing", label: supportTopicLabel("billing", locale), next: "billing-steps", topic: "billing" },
        { id: "topic-other", label: supportTopicLabel("other", locale), next: "other-details", topic: "other" },
      ],
    },
    "login-steps": {
      id: "login-steps",
      kind: "choice",
      messages: [
        t(
          locale,
          "Try these first: 1. Use the same login method you used when you signed up. 2. If you use email login, try password reset from the dashboard. 3. If Google signup and email signup used the same email, use the original method.",
          "먼저 이것부터 확인해 주세요. 1. 가입할 때 사용한 로그인 방식과 같은 방식으로 로그인해 보세요. 2. 이메일 로그인이라면 대시보드에서 비밀번호 재설정을 시도해 보세요. 3. 같은 이메일로 구글 가입과 이메일 가입을 혼용했다면 처음 사용한 방식으로 로그인해야 할 수 있어요.",
        ),
      ],
      choices: [resolvedChoice, needHelpChoice("login-details")],
    },
    "passcode-steps": {
      id: "passcode-steps",
      kind: "choice",
      messages: [
        t(
          locale,
          "Try these first: 1. Ask the channel owner whether the passcode changed. 2. Re-enter the channel from the latest shared link. 3. If you were inside before but got locked out, refresh once so the latest gate state loads.",
          "먼저 이것부터 확인해 주세요. 1. 방장에게 비밀번호가 바뀌었는지 확인해 보세요. 2. 가장 최근에 공유된 링크로 다시 입장해 보세요. 3. 원래 들어와 있었는데 막혔다면 새로고침 한 번으로 최신 잠금 상태를 불러와 보세요.",
        ),
      ],
      choices: [resolvedChoice, needHelpChoice("passcode-details")],
    },
    "blocked-steps": {
      id: "blocked-steps",
      kind: "choice",
      messages: [
        t(
          locale,
          "If you see a blocked or frozen state: 1. Check whether the owner left a block reason or notice. 2. If the room allows a one-time appeal, send it from the chat input. 3. If the whole channel is frozen, only the owner or platform team can review that state.",
          "차단 또는 동결 상태라면 이렇게 확인해 주세요. 1. 차단 사유나 공지 메시지가 남아 있는지 확인해 보세요. 2. 방에서 1회 이의 제기를 허용한다면 채팅 입력창에서 이의 제기를 보내세요. 3. 채널 전체가 동결된 경우에는 방장이나 운영팀만 상태를 검토할 수 있어요.",
        ),
      ],
      choices: [resolvedChoice, needHelpChoice("blocked-details")],
    },
    "reports-steps": {
      id: "reports-steps",
      kind: "choice",
      messages: [
        t(
          locale,
          "For safety or report questions: 1. Message-level reports are available from the message menu. 2. Channel-level reports are available from the header menu. 3. If you already reported something, include when you sent it and what you expected to happen.",
          "신고나 안전 관련 문의라면 이렇게 확인해 주세요. 1. 메시지 신고는 메시지 메뉴에서 할 수 있어요. 2. 채널 신고는 헤더 메뉴에서 할 수 있어요. 3. 이미 신고했다면 언제 신고했고 어떤 조치를 기대했는지 같이 알려주시면 좋아요.",
        ),
      ],
      choices: [resolvedChoice, needHelpChoice("reports-details")],
    },
    "live-steps": {
      id: "live-steps",
      kind: "choice",
      messages: [
        t(
          locale,
          "For live-session issues: 1. Live chat is separate from regular chat. 2. Live messages disappear when the live session ends. 3. If reactions or emoji effects look stale, reconnect once and try again.",
          "라이브 세션 문제라면 이렇게 확인해 주세요. 1. 라이브 채팅은 일반 채팅과 별도예요. 2. 라이브 메시지는 세션이 종료되면 사라져요. 3. 반응이나 이모지 효과가 이상하면 한 번 다시 연결한 뒤 시도해 보세요.",
        ),
      ],
      choices: [resolvedChoice, needHelpChoice("live-details")],
    },
    "billing-steps": {
      id: "billing-steps",
      kind: "choice",
      messages: [
        t(
          locale,
          "For purchase or billing issues: 1. Check the product name and purchase time. 2. Confirm which account email you used. 3. If something is missing, support will usually need those details before they can help.",
          "결제나 구매 문제라면 이렇게 확인해 주세요. 1. 구매한 상품 이름과 결제 시간을 확인해 주세요. 2. 어떤 계정 이메일로 결제했는지 확인해 주세요. 3. 누락 문제가 있다면 운영팀이 이 정보부터 필요로 할 가능성이 높아요.",
        ),
      ],
      choices: [resolvedChoice, needHelpChoice("billing-details")],
    },
    "login-details": textNode("login-details", "login", locale),
    "passcode-details": textNode("passcode-details", "passcode", locale),
    "blocked-details": textNode("blocked-details", "blocked", locale),
    "reports-details": textNode("reports-details", "reports", locale),
    "live-details": textNode("live-details", "live", locale),
    "billing-details": textNode("billing-details", "billing", locale),
    "other-details": textNode("other-details", "other", locale),
    "login-escalate": escalateNode("login", locale),
    "passcode-escalate": escalateNode("passcode", locale),
    "blocked-escalate": escalateNode("blocked", locale),
    "reports-escalate": escalateNode("reports", locale),
    "live-escalate": escalateNode("live", locale),
    "billing-escalate": escalateNode("billing", locale),
    "other-escalate": escalateNode("other", locale),
    resolved: {
      id: "resolved",
      kind: "terminal",
      resolution: "resolved",
      messages: [
        t(
          locale,
          "Glad that helped. If you need anything else later, you can start a new support flow from the beginning.",
          "도움이 되었다니 다행이에요. 나중에 또 도움이 필요하면 처음부터 새 지원 흐름을 시작할 수 있어요.",
        ),
      ],
    },
  };
}

function textNode(id: string, topic: SupportTopic, locale: UserLocale): SupportNode {
  return {
    id,
    kind: "text",
    messages: [
      t(
        locale,
        `Please describe the ${supportTopicLabel(topic, locale).toLowerCase()} issue in one message. Include what you already tried and what you expected to happen.`,
        `${supportTopicLabel(topic, locale)} 문제를 한 번에 설명해 주세요. 이미 시도한 것과 기대했던 동작도 함께 적어 주세요.`,
      ),
    ],
    placeholder: t(locale, "Describe the issue", "문제를 설명해 주세요"),
    submitLabel: t(locale, "Continue", "계속"),
  };
}

function escalateNode(topic: SupportTopic, locale: UserLocale): SupportNode {
  return {
    id: `${topic}-escalate`,
    kind: "escalate",
    resolution: "needs_handoff",
    messages: [
      t(
        locale,
        `I can send this ${supportTopicLabel(topic, locale).toLowerCase()} case to the platform support inbox with your summary attached.`,
        `${supportTopicLabel(topic, locale)} 문의를 입력한 요약과 함께 운영팀 지원함으로 전달할 수 있어요.`,
      ),
    ],
    escalationLabel: t(locale, "Contact support", "운영팀에 문의"),
  };
}

export function buildSupportSummary(input: {
  locale: UserLocale;
  topic: SupportTopic | string | null;
  events: SupportTranscriptEvent[];
}): string {
  const topicLabel = supportTopicLabel(input.topic, input.locale);
  const choices = input.events
    .filter((event) => event.event_type === "user_choice")
    .map((event) => {
      const label = typeof event.payload.label === "string" ? event.payload.label : "";
      return label.trim();
    })
    .filter(Boolean);
  const details = input.events
    .filter((event) => event.event_type === "user_text")
    .map((event) => {
      const text = typeof event.payload.text === "string" ? event.payload.text : "";
      return text.trim();
    })
    .filter(Boolean);

  const lines = [
    t(input.locale, "Support topic", "문의 주제") + `: ${topicLabel}`,
  ];
  if (choices.length > 0) {
    lines.push(
      t(input.locale, "Guided path", "안내 경로") + `: ${choices.join(" -> ")}`
    );
  }
  if (details.length > 0) {
    lines.push(
      t(input.locale, "User summary", "사용자 설명") + `: ${details[details.length - 1]}`
    );
  }
  return lines.join("\n");
}
