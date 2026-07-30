import type { UserLocale } from "./channel-moderation";
import type { SupportTopic } from "./support-flow";

interface SupportFlowLocaleStrings {
  topicLabels: Record<SupportTopic, string>;
  defaultTopicLabel: string;
  resolvedChoice: string;
  needHelpChoice: string;
  startMessage: string;
  stepMessages: Record<Exclude<SupportTopic, "other">, string>;
  resolvedMessage: string;
  textPlaceholder: string;
  textSubmitLabel: string;
  escalationLabel: string;
  summaryTopicLabel: string;
  summaryPathLabel: string;
  summaryUserLabel: string;
  textPrompt: (topicLabel: string) => string;
  escalatePrompt: (topicLabel: string) => string;
}

const SUPPORT_FLOW_LOCALES: Record<UserLocale, SupportFlowLocaleStrings> = {
  en: {
    topicLabels: {
      login: "Login or account",
      passcode: "Passcode or access",
      blocked: "Blocked or frozen",
      reports: "Report or safety",
      live: "Live feature",
      other: "Other",
    },
    defaultTopicLabel: "Support",
    resolvedChoice: "That fixed it",
    needHelpChoice: "I still need help",
    startMessage: "Tell me what you need help with first. I’ll try the quickest steps before I connect you to support.",
    stepMessages: {
      login: "Try these first: 1. Use the same login method you used when you signed up. 2. If you use email login, try password reset from the dashboard. 3. If Google signup and email signup used the same email, use the original method.",
      passcode: "Try these first: 1. Ask the channel owner whether the passcode changed. 2. Re-enter the channel from the latest shared link. 3. If you were inside before but got locked out, refresh once so the latest gate state loads.",
      blocked: "If you see a blocked or frozen state: 1. Check whether the owner left a block reason or notice. 2. If the room allows a one-time appeal, send it from the chat input. 3. If the whole channel is frozen, only the owner or platform team can review that state.",
      reports: "For safety or report questions: 1. Message-level reports are available from the message menu. 2. Channel-level reports are available from the header menu. 3. If you already reported something, include when you sent it and what you expected to happen.",
      live: "For live-session issues: 1. Live chat is separate from regular chat. 2. Live messages disappear when the live session ends. 3. If reactions or emoji effects look stale, reconnect once and try again.",
    },
    resolvedMessage: "Glad that helped. If you need anything else later, you can start a new support flow from the beginning.",
    textPlaceholder: "Describe the issue",
    textSubmitLabel: "Continue",
    escalationLabel: "Contact support",
    summaryTopicLabel: "Support topic",
    summaryPathLabel: "Guided path",
    summaryUserLabel: "User summary",
    textPrompt: (topicLabel) => `Please describe the ${topicLabel.toLowerCase()} issue in one message. Include what you already tried and what you expected to happen.`,
    escalatePrompt: (topicLabel) => `I can send this ${topicLabel.toLowerCase()} case to the platform support inbox with your summary attached.`,
  },
  ko: {
    topicLabels: {
      login: "로그인 또는 계정",
      passcode: "비밀번호 또는 입장",
      blocked: "차단 또는 동결",
      reports: "신고 또는 안전",
      live: "라이브 기능",
      other: "기타",
    },
    defaultTopicLabel: "고객지원",
    resolvedChoice: "해결됐어요",
    needHelpChoice: "아직 도움이 필요해요",
    startMessage: "먼저 어떤 도움이 필요한지 알려주세요. 운영팀으로 넘기기 전에 빠르게 확인할 수 있는 방법부터 안내할게요.",
    stepMessages: {
      login: "먼저 이것부터 확인해 주세요. 1. 가입할 때 사용한 로그인 방식과 같은 방식으로 로그인해 보세요. 2. 이메일 로그인이라면 대시보드에서 비밀번호 재설정을 시도해 보세요. 3. 같은 이메일로 구글 가입과 이메일 가입을 혼용했다면 처음 사용한 방식으로 로그인해야 할 수 있어요.",
      passcode: "먼저 이것부터 확인해 주세요. 1. 방장에게 비밀번호가 바뀌었는지 확인해 보세요. 2. 가장 최근에 공유된 링크로 다시 입장해 보세요. 3. 원래 들어와 있었는데 막혔다면 새로고침 한 번으로 최신 잠금 상태를 불러와 보세요.",
      blocked: "차단 또는 동결 상태라면 이렇게 확인해 주세요. 1. 차단 사유나 공지 메시지가 남아 있는지 확인해 보세요. 2. 방에서 1회 이의 제기를 허용한다면 채팅 입력창에서 이의 제기를 보내세요. 3. 채널 전체가 동결된 경우에는 방장이나 운영팀만 상태를 검토할 수 있어요.",
      reports: "신고나 안전 관련 문의라면 이렇게 확인해 주세요. 1. 메시지 신고는 메시지 메뉴에서 할 수 있어요. 2. 채널 신고는 헤더 메뉴에서 할 수 있어요. 3. 이미 신고했다면 언제 신고했고 어떤 조치를 기대했는지 같이 알려주시면 좋아요.",
      live: "라이브 세션 문제라면 이렇게 확인해 주세요. 1. 라이브 채팅은 일반 채팅과 별도예요. 2. 라이브 메시지는 세션이 종료되면 사라져요. 3. 반응이나 이모지 효과가 이상하면 한 번 다시 연결한 뒤 시도해 보세요.",
    },
    resolvedMessage: "도움이 되었다니 다행이에요. 나중에 또 도움이 필요하면 처음부터 새 지원 흐름을 시작할 수 있어요.",
    textPlaceholder: "문제를 설명해 주세요",
    textSubmitLabel: "계속",
    escalationLabel: "운영팀에 문의",
    summaryTopicLabel: "문의 주제",
    summaryPathLabel: "안내 경로",
    summaryUserLabel: "사용자 설명",
    textPrompt: (topicLabel) => `${topicLabel} 문제를 한 번에 설명해 주세요. 이미 시도한 것과 기대했던 동작도 함께 적어 주세요.`,
    escalatePrompt: (topicLabel) => `${topicLabel} 문의를 입력한 요약과 함께 운영팀 지원함으로 전달할 수 있어요.`,
  },
};

export function getSupportFlowLocale(locale: UserLocale): SupportFlowLocaleStrings {
  return SUPPORT_FLOW_LOCALES[locale];
}
