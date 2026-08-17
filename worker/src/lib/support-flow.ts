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
        next: `answer-${question.id}`,
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
