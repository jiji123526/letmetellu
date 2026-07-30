import type { UserLocale } from "./channel-moderation";
import { getSupportFlowLocale } from "./support-flow-locales";

export type SupportTopic =
  | "login"
  | "passcode"
  | "blocked"
  | "reports"
  | "live"
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

export function supportTopicLabel(topic: SupportTopic | string | null | undefined, locale: UserLocale): string {
  const copy = getSupportFlowLocale(locale);
  switch (topic) {
    case "login":
      return copy.topicLabels.login;
    case "passcode":
      return copy.topicLabels.passcode;
    case "blocked":
      return copy.topicLabels.blocked;
    case "reports":
      return copy.topicLabels.reports;
    case "live":
      return copy.topicLabels.live;
    case "other":
      return copy.topicLabels.other;
    default:
      return copy.defaultTopicLabel;
  }
}

export function getSupportNode(nodeId: string, locale: UserLocale): SupportNode | null {
  const nodes = buildSupportFlow(locale);
  return nodes[nodeId] || null;
}

export function buildSupportFlow(locale: UserLocale): Record<string, SupportNode> {
  const copy = getSupportFlowLocale(locale);
  const resolvedChoice: SupportChoice = {
    id: "resolved",
    label: copy.resolvedChoice,
    next: "resolved",
  };
  const needHelpChoice = (next: string): SupportChoice => ({
    id: `need-help-${next}`,
    label: copy.needHelpChoice,
    next,
  });

  return {
    start: {
      id: "start",
      kind: "choice",
      messages: [copy.startMessage],
      choices: [
        { id: "topic-login", label: supportTopicLabel("login", locale), next: "login-steps", topic: "login" },
        { id: "topic-passcode", label: supportTopicLabel("passcode", locale), next: "passcode-steps", topic: "passcode" },
        { id: "topic-blocked", label: supportTopicLabel("blocked", locale), next: "blocked-steps", topic: "blocked" },
        { id: "topic-reports", label: supportTopicLabel("reports", locale), next: "reports-steps", topic: "reports" },
        { id: "topic-live", label: supportTopicLabel("live", locale), next: "live-steps", topic: "live" },
        { id: "topic-other", label: supportTopicLabel("other", locale), next: "other-details", topic: "other" },
      ],
    },
    "login-steps": {
      id: "login-steps",
      kind: "choice",
      messages: [copy.stepMessages.login],
      choices: [resolvedChoice, needHelpChoice("login-details")],
    },
    "passcode-steps": {
      id: "passcode-steps",
      kind: "choice",
      messages: [copy.stepMessages.passcode],
      choices: [resolvedChoice, needHelpChoice("passcode-details")],
    },
    "blocked-steps": {
      id: "blocked-steps",
      kind: "choice",
      messages: [copy.stepMessages.blocked],
      choices: [resolvedChoice, needHelpChoice("blocked-details")],
    },
    "reports-steps": {
      id: "reports-steps",
      kind: "choice",
      messages: [copy.stepMessages.reports],
      choices: [resolvedChoice, needHelpChoice("reports-details")],
    },
    "live-steps": {
      id: "live-steps",
      kind: "choice",
      messages: [copy.stepMessages.live],
      choices: [resolvedChoice, needHelpChoice("live-details")],
    },
    "login-details": textNode("login-details", "login", locale),
    "passcode-details": textNode("passcode-details", "passcode", locale),
    "blocked-details": textNode("blocked-details", "blocked", locale),
    "reports-details": textNode("reports-details", "reports", locale),
    "live-details": textNode("live-details", "live", locale),
    "other-details": textNode("other-details", "other", locale),
    "login-escalate": escalateNode("login", locale),
    "passcode-escalate": escalateNode("passcode", locale),
    "blocked-escalate": escalateNode("blocked", locale),
    "reports-escalate": escalateNode("reports", locale),
    "live-escalate": escalateNode("live", locale),
    "other-escalate": escalateNode("other", locale),
    resolved: {
      id: "resolved",
      kind: "terminal",
      resolution: "resolved",
      messages: [copy.resolvedMessage],
    },
  };
}

function textNode(id: string, topic: SupportTopic, locale: UserLocale): SupportNode {
  const copy = getSupportFlowLocale(locale);
  const topicLabel = supportTopicLabel(topic, locale);
  return {
    id,
    kind: "text",
    messages: [copy.textPrompt(topicLabel)],
    placeholder: copy.textPlaceholder,
    submitLabel: copy.textSubmitLabel,
  };
}

function escalateNode(topic: SupportTopic, locale: UserLocale): SupportNode {
  const copy = getSupportFlowLocale(locale);
  const topicLabel = supportTopicLabel(topic, locale);
  return {
    id: `${topic}-escalate`,
    kind: "escalate",
    resolution: "needs_handoff",
    messages: [copy.escalatePrompt(topicLabel)],
    escalationLabel: copy.escalationLabel,
  };
}

export function buildSupportSummary(input: {
  locale: UserLocale;
  topic: SupportTopic | string | null;
  events: SupportTranscriptEvent[];
}): string {
  const copy = getSupportFlowLocale(input.locale);
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
    `${copy.summaryTopicLabel}: ${topicLabel}`,
  ];
  if (choices.length > 0) {
    lines.push(
      `${copy.summaryPathLabel}: ${choices.join(" -> ")}`
    );
  }
  if (details.length > 0) {
    lines.push(
      `${copy.summaryUserLabel}: ${details[details.length - 1]}`
    );
  }
  return lines.join("\n");
}
