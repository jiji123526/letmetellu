import type { UserLocale } from "./channel-moderation.ts";
import {
  getSupportFlowLocale,
  type SupportQuestionCopy,
  type SupportQuestionGroupCopy,
} from "./support-flow-locales.ts";

export type GuidedSupportTopic =
  | "account"
  | "access"
  | "messages"
  | "dm"
  | "reports"
  | "live"
  | "info";

export type SupportAudience = "user" | "admin";

export type SupportTopic =
  | GuidedSupportTopic
  | "other"
  | "login"
  | "passcode"
  | "blocked";

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

const GUIDED_TOPICS: GuidedSupportTopic[] = [
  "account",
  "access",
  "messages",
  "dm",
  "reports",
  "live",
  "info",
];

const SUPPORT_AUDIENCES: SupportAudience[] = ["user", "admin"];

export function supportTopicLabel(topic: SupportTopic | string | null | undefined, locale: UserLocale): string {
  const copy = getSupportFlowLocale(locale);
  return topic && topic in copy.topicLabels
    ? copy.topicLabels[topic as SupportTopic]
    : copy.defaultTopicLabel;
}

export function getSupportNode(nodeId: string, locale: UserLocale): SupportNode | null {
  return buildSupportFlow(locale)[nodeId] || null;
}

function diagnosticQuestionNext(questionId: string): string | null {
  if (questionId === "notifications-not-arriving") return "notification-login-check";
  if (questionId === "admin-notifications-not-arriving") return "admin-notification-login-check";
  if (questionId === "live-notification-missing") return "live-notification-login-check";
  return null;
}

function questionMenuNode(
  id: string,
  questions: SupportQuestionCopy[],
  locale: UserLocale,
  backTo?: string,
): SupportNode {
  const copy = getSupportFlowLocale(locale);
  return {
    id,
    kind: "choice",
    messages: [copy.questionPrompt],
    choices: [
      ...questions.map((question) => ({
        id: `question-${question.id}`,
        label: question.label,
        next: diagnosticQuestionNext(question.id) || `answer-${question.id}`,
      })),
      ...(backTo ? [{
        id: `back-${id}`,
        label: copy.backChoice,
        next: backTo,
      }] : []),
    ],
  };
}

function questionGroupMenuNode(
  audience: SupportAudience,
  topic: GuidedSupportTopic,
  groups: SupportQuestionGroupCopy[],
  locale: UserLocale,
): SupportNode {
  const copy = getSupportFlowLocale(locale);
  return {
    id: topicQuestionNodeId(audience, topic),
    kind: "choice",
    messages: [copy.groupPrompt],
    choices: [
      ...groups.map((group) => ({
        id: `group-${audience}-${topic}-${group.id}`,
        label: group.label,
        next: groupedQuestionNodeId(audience, topic, group.id),
      })),
      {
        id: `back-${audience}-${topic}`,
        label: copy.backChoice,
        next: `${audience}-topics`,
      },
    ],
  };
}

function answerNode(
  audience: SupportAudience,
  topic: GuidedSupportTopic,
  question: SupportQuestionCopy,
  locale: UserLocale,
): SupportNode {
  const copy = getSupportFlowLocale(locale);
  return {
    id: `answer-${question.id}`,
    kind: "choice",
    messages: [question.answer],
    choices: [
      {
        id: `resolved-${question.id}`,
        label: copy.resolvedChoice,
        next: "resolved",
      },
      {
        id: `need-help-${question.id}`,
        label: copy.needHelpChoice,
        next: detailNodeId(audience, topic),
      },
      {
        id: `back-${question.id}`,
        label: copy.backToTopicsChoice,
        next: `${audience}-topics`,
      },
    ],
  };
}

function topicQuestionNodeId(audience: SupportAudience, topic: GuidedSupportTopic): string {
  return audience === "user" ? `${topic}-questions` : `admin-${topic}-questions`;
}

function groupedQuestionNodeId(audience: SupportAudience, topic: GuidedSupportTopic, groupId: string): string {
  return audience === "user" ? `${topic}-${groupId}-questions` : `admin-${topic}-${groupId}-questions`;
}

function detailNodeId(audience: SupportAudience, topic: SupportTopic): string {
  return audience === "user" ? `${topic}-details` : `admin-${topic}-details`;
}

function escalateNodeId(audience: SupportAudience, topic: SupportTopic): string {
  return audience === "user" ? `${topic}-escalate` : `admin-${topic}-escalate`;
}

function topicMenuNode(audience: SupportAudience, locale: UserLocale): SupportNode {
  const copy = getSupportFlowLocale(locale);
  return {
    id: `${audience}-topics`,
    kind: "choice",
    messages: [copy.topicPrompt(audience)],
    choices: [
      ...GUIDED_TOPICS.map((topic) => ({
        id: `topic-${audience}-${topic}`,
        label: supportTopicLabel(topic, locale),
        next: topicQuestionNodeId(audience, topic),
        topic,
      })),
      {
        id: `topic-${audience}-other`,
        label: supportTopicLabel("other", locale),
        next: detailNodeId(audience, "other"),
        topic: "other" as const,
      },
      {
        id: `back-${audience}-topics`,
        label: copy.backChoice,
        next: "start",
      },
    ],
  };
}

function diagnosticResultNode(
  id: string,
  message: string,
  audience: SupportAudience,
  topic: GuidedSupportTopic,
  locale: UserLocale,
): SupportNode {
  const copy = getSupportFlowLocale(locale);
  return {
    id,
    kind: "choice",
    messages: [message],
    choices: [
      {
        id: `resolved-${id}`,
        label: copy.resolvedChoice,
        next: "resolved",
      },
      {
        id: `need-help-${id}`,
        label: copy.needHelpChoice,
        next: detailNodeId(audience, topic),
      },
      {
        id: `back-${id}`,
        label: copy.backToTopicsChoice,
        next: `${audience}-topics`,
      },
    ],
  };
}

function notificationDiagnosticNodes(locale: UserLocale): Record<string, SupportNode> {
  const ko = locale === "ko";
  const yes = ko ? "네" : "Yes";
  const no = ko ? "아니요" : "No";

  const signedInQuestion = ko
    ? "현재 로그인되어 있나요?"
    : "Are you currently signed in?";

  const enabledQuestion = ko
    ? "해당 채널의 알림이 중요 또는 모두로 켜져 있나요?"
    : "Is Notifications set to Important or All for this channel?";

  const iphoneQuestion = ko
    ? "iPhone에서 사용 중인가요?"
    : "Are you using an iPhone?";

  const homeScreenQuestion = ko
    ? "홈 화면에 추가한 yap.에서 사용 중인가요?"
    : "Are you using yap. from the Home Screen?";

  const permissionQuestion = ko
    ? "기기 또는 브라우저에서 yap. 알림이 허용되어 있나요?"
    : "Are notifications for yap. allowed by your device or browser?";

  const normalSituationQuestion = ko
    ? "알림이 오지 않았던 상황은 무엇인가요?"
    : "Which situation describes the missing notification?";

  const liveVisibleQuestion = ko
    ? "라이브 시작 당시 같은 기기에서 그 채널을 보고 있었나요?"
    : "Were you viewing that channel on the same device when live started?";

  const loginRequired = ko
    ? "알림을 받으려면 먼저 로그인해 주세요."
    : "Sign in first to receive notifications.";

  const enableRequired = ko
    ? "채널 설정에서 알림을 중요 또는 모두로 켜 주세요."
    : "Set Notifications to Important or All in the channel Settings.";

  const iosRequired = ko
    ? "iPhone에서는 yap.을 홈 화면에 추가한 뒤 홈 화면의 yap.에서 사용해 주세요."
    : "On iPhone, add yap. to the Home Screen and use it from there.";

  const permissionRequired = ko
    ? "기기 또는 브라우저 설정에서 yap. 알림을 허용해 주세요."
    : "Allow notifications for yap. in your device or browser settings.";

  const ownMessage = ko
    ? "내가 보낸 메시지에는 알림이 오지 않아요."
    : "Notifications are not sent for your own messages.";

  const visibleChannel = ko
    ? "같은 기기에서 해당 채널을 보고 있을 때는 중복 알림이 표시되지 않아요."
    : "A duplicate notification is not shown while that channel is visible on the same device.";

  const liveVisible = ko
    ? "같은 기기에서 해당 채널을 보고 있을 때는 라이브 시작 푸시가 중복 표시되지 않아요."
    : "A live-start push is not duplicated while that channel is visible on the same device.";

  const stillBroken = ko
    ? "설정은 정상으로 보여요. 계속 문제가 있다면 상황을 알려 주세요."
    : "Your settings look correct. If the problem continues, describe what happened.";

  function standardTree(
    prefix: string,
    audience: SupportAudience,
  ): Record<string, SupportNode> {
    return {
      [`${prefix}-login-check`]: {
        id: `${prefix}-login-check`,
        kind: "choice",
        messages: [signedInQuestion],
        choices: [
          { id: `${prefix}-login-yes`, label: yes, next: `${prefix}-mode-check` },
          { id: `${prefix}-login-no`, label: no, next: `${prefix}-login-required` },
        ],
      },

      [`${prefix}-login-required`]: diagnosticResultNode(
        `${prefix}-login-required`,
        loginRequired,
        audience,
        "account",
        locale,
      ),

      [`${prefix}-mode-check`]: {
        id: `${prefix}-mode-check`,
        kind: "choice",
        messages: [enabledQuestion],
        choices: [
          { id: `${prefix}-mode-yes`, label: yes, next: `${prefix}-iphone-check` },
          { id: `${prefix}-mode-no`, label: no, next: `${prefix}-mode-required` },
        ],
      },

      [`${prefix}-mode-required`]: diagnosticResultNode(
        `${prefix}-mode-required`,
        enableRequired,
        audience,
        "account",
        locale,
      ),

      [`${prefix}-iphone-check`]: {
        id: `${prefix}-iphone-check`,
        kind: "choice",
        messages: [iphoneQuestion],
        choices: [
          { id: `${prefix}-iphone-yes`, label: yes, next: `${prefix}-home-screen-check` },
          { id: `${prefix}-iphone-no`, label: no, next: `${prefix}-permission-check` },
        ],
      },

      [`${prefix}-home-screen-check`]: {
        id: `${prefix}-home-screen-check`,
        kind: "choice",
        messages: [homeScreenQuestion],
        choices: [
          { id: `${prefix}-home-yes`, label: yes, next: `${prefix}-permission-check` },
          { id: `${prefix}-home-no`, label: no, next: `${prefix}-ios-required` },
        ],
      },

      [`${prefix}-ios-required`]: diagnosticResultNode(
        `${prefix}-ios-required`,
        iosRequired,
        audience,
        "account",
        locale,
      ),

      [`${prefix}-permission-check`]: {
        id: `${prefix}-permission-check`,
        kind: "choice",
        messages: [permissionQuestion],
        choices: [
          {
            id: `${prefix}-permission-yes`,
            label: yes,
            next: `${prefix}-situation-check`,
          },
          {
            id: `${prefix}-permission-no`,
            label: no,
            next: `${prefix}-permission-required`,
          },
        ],
      },

      [`${prefix}-permission-required`]: diagnosticResultNode(
        `${prefix}-permission-required`,
        permissionRequired,
        audience,
        "account",
        locale,
      ),

      [`${prefix}-situation-check`]: {
        id: `${prefix}-situation-check`,
        kind: "choice",
        messages: [normalSituationQuestion],
        choices: audience === "user"
          ? [
              {
                id: `${prefix}-own`,
                label: ko ? "내가 보낸 메시지였어요" : "It was my own message",
                next: `${prefix}-own-message`,
              },
              {
                id: `${prefix}-visible`,
                label: ko ? "그 채널을 보고 있었어요" : "I was viewing that channel",
                next: `${prefix}-channel-visible`,
              },
              {
                id: `${prefix}-other`,
                label: ko ? "둘 다 아니에요" : "Neither",
                next: `${prefix}-still-broken`,
              },
            ]
          : [
              {
                id: `${prefix}-visible`,
                label: ko ? "그 채널을 보고 있었어요" : "I was viewing that channel",
                next: `${prefix}-channel-visible`,
              },
              {
                id: `${prefix}-other`,
                label: ko ? "아니에요" : "No",
                next: `${prefix}-still-broken`,
              },
            ],
      },

      [`${prefix}-own-message`]: diagnosticResultNode(
        `${prefix}-own-message`,
        ownMessage,
        audience,
        "account",
        locale,
      ),

      [`${prefix}-channel-visible`]: diagnosticResultNode(
        `${prefix}-channel-visible`,
        visibleChannel,
        audience,
        "account",
        locale,
      ),

      [`${prefix}-still-broken`]: diagnosticResultNode(
        `${prefix}-still-broken`,
        stillBroken,
        audience,
        "account",
        locale,
      ),
    };
  }

  const liveNodes: Record<string, SupportNode> = {
    "live-notification-login-check": {
      id: "live-notification-login-check",
      kind: "choice",
      messages: [signedInQuestion],
      choices: [
        { id: "live-login-yes", label: yes, next: "live-notification-mode-check" },
        { id: "live-login-no", label: no, next: "live-notification-login-required" },
      ],
    },

    "live-notification-login-required": diagnosticResultNode(
      "live-notification-login-required",
      loginRequired,
      "user",
      "live",
      locale,
    ),

    "live-notification-mode-check": {
      id: "live-notification-mode-check",
      kind: "choice",
      messages: [enabledQuestion],
      choices: [
        { id: "live-mode-yes", label: yes, next: "live-notification-visible-check" },
        { id: "live-mode-no", label: no, next: "live-notification-mode-required" },
      ],
    },

    "live-notification-mode-required": diagnosticResultNode(
      "live-notification-mode-required",
      enableRequired,
      "user",
      "live",
      locale,
    ),

    "live-notification-visible-check": {
      id: "live-notification-visible-check",
      kind: "choice",
      messages: [liveVisibleQuestion],
      choices: [
        { id: "live-visible-yes", label: yes, next: "live-notification-visible" },
        { id: "live-visible-no", label: no, next: "live-notification-iphone-check" },
      ],
    },

    "live-notification-visible": diagnosticResultNode(
      "live-notification-visible",
      liveVisible,
      "user",
      "live",
      locale,
    ),

    "live-notification-iphone-check": {
      id: "live-notification-iphone-check",
      kind: "choice",
      messages: [iphoneQuestion],
      choices: [
        { id: "live-iphone-yes", label: yes, next: "live-notification-home-screen-check" },
        { id: "live-iphone-no", label: no, next: "live-notification-permission-check" },
      ],
    },

    "live-notification-home-screen-check": {
      id: "live-notification-home-screen-check",
      kind: "choice",
      messages: [homeScreenQuestion],
      choices: [
        { id: "live-home-yes", label: yes, next: "live-notification-permission-check" },
        { id: "live-home-no", label: no, next: "live-notification-ios-required" },
      ],
    },

    "live-notification-ios-required": diagnosticResultNode(
      "live-notification-ios-required",
      iosRequired,
      "user",
      "live",
      locale,
    ),

    "live-notification-permission-check": {
      id: "live-notification-permission-check",
      kind: "choice",
      messages: [permissionQuestion],
      choices: [
        { id: "live-permission-yes", label: yes, next: "live-notification-still-broken" },
        { id: "live-permission-no", label: no, next: "live-notification-permission-required" },
      ],
    },

    "live-notification-permission-required": diagnosticResultNode(
      "live-notification-permission-required",
      permissionRequired,
      "user",
      "live",
      locale,
    ),

    "live-notification-still-broken": diagnosticResultNode(
      "live-notification-still-broken",
      stillBroken,
      "user",
      "live",
      locale,
    ),
  };

  return {
    ...standardTree("notification", "user"),
    ...standardTree("admin-notification", "admin"),
    ...liveNodes,
  };
}

export function buildSupportFlow(locale: UserLocale): Record<string, SupportNode> {
  const copy = getSupportFlowLocale(locale);
  const nodes: Record<string, SupportNode> = {
    start: {
      id: "start",
      kind: "choice",
      messages: [copy.startMessage],
      choices: [
        {
          id: "audience-user",
          label: copy.audienceLabels.user,
          next: "user-topics",
        },
        {
          id: "audience-admin",
          label: copy.audienceLabels.admin,
          next: "admin-topics",
        },
      ],
    },
    resolved: {
      id: "resolved",
      kind: "terminal",
      resolution: "resolved",
      messages: [copy.resolvedMessage],
    },
    "user-topics": topicMenuNode("user", locale),
    "admin-topics": topicMenuNode("admin", locale),
    ...notificationDiagnosticNodes(locale),
  };

  for (const audience of SUPPORT_AUDIENCES) {
    for (const topic of GUIDED_TOPICS) {
      const questions = copy.questions[audience][topic];
      const groups = copy.questionGroups[audience][topic];
      const questionNodeId = topicQuestionNodeId(audience, topic);
      nodes[questionNodeId] = groups.length > 0
        ? questionGroupMenuNode(audience, topic, groups, locale)
        : questionMenuNode(questionNodeId, questions, locale, `${audience}-topics`);
      const questionsById = new Map(questions.map((question) => [question.id, question]));
      for (const group of groups) {
        const groupedQuestions = group.questionIds.map((questionId) => {
          const question = questionsById.get(questionId);
          if (!question) {
            throw new Error(`Missing ${audience} ${topic} support question: ${questionId}`);
          }
          return question;
        });
        nodes[groupedQuestionNodeId(audience, topic, group.id)] = questionMenuNode(
          groupedQuestionNodeId(audience, topic, group.id),
          groupedQuestions,
          locale,
          questionNodeId,
        );
      }
      nodes[detailNodeId(audience, topic)] = textNode(detailNodeId(audience, topic), topic, locale);
      nodes[escalateNodeId(audience, topic)] = escalateNode(escalateNodeId(audience, topic), topic, locale);
      for (const question of questions) {
        nodes[`answer-${question.id}`] = answerNode(audience, topic, question, locale);
      }
    }
  }

  nodes["other-details"] = textNode("other-details", "other", locale);
  nodes["other-escalate"] = escalateNode("other-escalate", "other", locale);
  nodes["admin-other-details"] = textNode("admin-other-details", "other", locale);
  nodes["admin-other-escalate"] = escalateNode("admin-other-escalate", "other", locale);

  // Keep nodes used by sessions that may still be open during deployment.
  for (const topic of ["login", "passcode", "blocked"] as const) {
    nodes[`${topic}-steps`] = legacyStepNode(topic, locale);
    nodes[`${topic}-details`] = textNode(`${topic}-details`, topic, locale);
    nodes[`${topic}-escalate`] = escalateNode(`${topic}-escalate`, topic, locale);
  }
  nodes["reports-steps"] = legacyStepNode("reports", locale);
  nodes["live-steps"] = legacyStepNode("live", locale);

  return nodes;
}

function legacyStepNode(
  topic: "login" | "passcode" | "blocked" | "reports" | "live",
  locale: UserLocale,
): SupportNode {
  const copy = getSupportFlowLocale(locale);
  return {
    id: `${topic}-steps`,
    kind: "choice",
    messages: [copy.legacyStepMessages[topic]],
    choices: [
      { id: `legacy-resolved-${topic}`, label: copy.resolvedChoice, next: "resolved" },
      { id: `legacy-need-help-${topic}`, label: copy.needHelpChoice, next: `${topic}-details` },
      { id: `legacy-back-${topic}`, label: copy.backToTopicsChoice, next: "user-topics" },
    ],
  };
}

function textNode(id: string, topic: SupportTopic, locale: UserLocale): SupportNode {
  const copy = getSupportFlowLocale(locale);
  return {
    id,
    kind: "text",
    messages: [copy.textPrompt(supportTopicLabel(topic, locale))],
    placeholder: copy.textPlaceholder,
    submitLabel: copy.textSubmitLabel,
  };
}

function escalateNode(id: string, topic: SupportTopic, locale: UserLocale): SupportNode {
  const copy = getSupportFlowLocale(locale);
  return {
    id,
    kind: "escalate",
    resolution: "needs_handoff",
    messages: [copy.escalatePrompt(supportTopicLabel(topic, locale))],
    escalationLabel: copy.escalationLabel,
  };
}

export function buildSupportSummary(input: {
  locale: UserLocale;
  topic: SupportTopic | string | null;
  events: SupportTranscriptEvent[];
}): string {
  const copy = getSupportFlowLocale(input.locale);
  const choices = input.events
    .filter((event) => event.event_type === "user_choice")
    .map((event) => typeof event.payload.label === "string" ? event.payload.label.trim() : "")
    .filter(Boolean);
  const details = input.events
    .filter((event) => event.event_type === "user_text")
    .map((event) => typeof event.payload.text === "string" ? event.payload.text.trim() : "")
    .filter(Boolean);
  const lines = [
    `${copy.summaryTopicLabel}: ${supportTopicLabel(input.topic, input.locale)}`,
  ];
  if (choices.length > 0) {
    lines.push(`${copy.summaryPathLabel}: ${choices.join(" -> ")}`);
  }
  if (details.length > 0) {
    lines.push(`${copy.summaryUserLabel}: ${details[details.length - 1]}`);
  }
  return lines.join("\n");
}
