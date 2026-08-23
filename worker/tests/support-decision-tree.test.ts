import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSupportFlow,
  type GuidedSupportTopic,
  type SupportNode,
} from "../src/lib/support-flow.ts";

const supportRouteSource = readFileSync(
  new URL("../src/routes/support.ts", import.meta.url),
  "utf8",
);

const TOPICS: GuidedSupportTopic[] = [
  "account",
  "access",
  "messages",
  "dm",
  "reports",
  "live",
  "info",
];

const USER_QUESTION_IDS = [
  "signup",
  "create-channel",
  "channel-account-required",
  "change-language",
  "change-font-size",
  "change-bubble-color",
  "personal-settings-scope",
  "enable-notifications",
  "notifications-not-arriving",
  "reopen-guide",
  "find-channel-menu",
  "passcode-required",
  "passcode-again",
  "passcode-stopped",
  "find-passcode-hint",
  "lost-access-refresh",
  "reply",
  "reaction",
  "different-emoji",
  "edit-own",
  "delete-own",
  "edit-others",
  "long-press-menu",
  "send-dm",
  "dm-visibility",
  "find-sent-dms",
  "other-visitors",
  "read-owner-replies",
  "reply-to-owner",
  "new-dm-required",
  "delete-dm-thread",
  "dm-unavailable",
  "report-message",
  "cancel-message-report",
  "report-channel",
  "report-difference",
  "cannot-send",
  "know-blocked",
  "what-is-appeal",
  "when-appeal",
  "appeal-block",
  "one-appeal",
  "what-is-freeze",
  "who-can-freeze",
  "channel-frozen",
  "send-while-frozen",
  "dm-while-frozen",
  "frozen-history",
  "unfreeze-channel",
  "what-is-live",
  "live-separate",
  "normal-messages-live",
  "live-messages-disappeared",
  "recover-live",
  "ended-live-send",
  "live-duration",
  "live-notification-missing",
  "channel-rules",
  "notice-meaning",
  "notice-reappeared",
  "behavior-changed",
] as const;

const ADMIN_QUESTION_IDS = [
  "admin-create-channel",
  "admin-channel-limit",
  "admin-open-admin-settings",
  "admin-edit-profile",
  "admin-change-default-color",
  "admin-change-background",
  "admin-profile-visibility",
  "admin-enable-notifications",
  "admin-notifications-not-arriving",
  "admin-edit-welcome",
  "admin-visitor-onboarding",
  "admin-set-passcode",
  "admin-remove-passcode",
  "admin-passcode-hint",
  "admin-passcode-repeat",
  "admin-visitor-access-failed",
  "admin-reply-message",
  "admin-react-message",
  "admin-edit-own-message",
  "admin-delete-visitor-message",
  "admin-message-menu",
  "admin-enable-dm",
  "admin-disable-dm",
  "admin-dm-disabled-for-visitors",
  "admin-reply-dm",
  "admin-dm-reply-photo",
  "admin-delete-dm-reply",
  "admin-user-delete-dm-thread",
  "admin-review-message-report",
  "admin-block-user",
  "admin-unblock-user",
  "admin-banned-words",
  "admin-enable-appeals",
  "admin-review-appeal",
  "admin-channel-reported",
  "admin-platform-freeze",
  "admin-freeze-chat",
  "admin-unfreeze-chat",
  "admin-frozen-dm",
  "admin-start-live",
  "admin-live-separate",
  "admin-live-emoji",
  "admin-live-duration",
  "admin-end-live",
  "admin-live-history",
  "admin-edit-rules",
  "admin-post-notice",
  "admin-notice-reappears",
  "admin-where-users-see-info",
] as const;

const EXPECTED_QUESTION_IDS = [...USER_QUESTION_IDS, ...ADMIN_QUESTION_IDS] as const;

function expectedTopicMenu(questionId: string): string {
  return questionId.startsWith("admin-") ? "admin-topics" : "user-topics";
}

function followTextNode(node: SupportNode): string | null {
  return node.kind === "text"
    ? node.id.replace(/-details$/, "-escalate")
    : null;
}

test("guided support exposes every user and admin question in both locales", () => {
  const localeQuestionLabels: Record<string, string[]> = {};

  for (const locale of ["en", "ko"] as const) {
    const flow = buildSupportFlow(locale);
    assert.deepEqual(
      flow.start.choices?.map((choice) => choice.next),
      ["user-topics", "admin-topics"],
    );
    assert.equal(flow["user-topics"].choices?.length, TOPICS.length + 2);
    assert.equal(flow["admin-topics"].choices?.length, TOPICS.length + 2);

    const questionIds = Object.keys(flow)
      .filter((nodeId) => nodeId.startsWith("answer-"))
      .map((nodeId) => nodeId.replace(/^answer-/, ""));
    assert.deepEqual(new Set(questionIds), new Set(EXPECTED_QUESTION_IDS));
    localeQuestionLabels[locale] = EXPECTED_QUESTION_IDS.map((id) => {
      const answer = flow[`answer-${id}`];
      assert.equal(answer.kind, "choice");
      assert.ok(answer.messages[0]);
      assert.ok(answer.messages[0].length <= 180);
      assert.doesNotMatch(answer.messages[0], /\n/);
      assert.equal(answer.choices?.length, 3);
      assert.equal(answer.choices?.[0].next, "resolved");
      assert.match(answer.choices?.[1].next || "", /-details$/);
      assert.equal(answer.choices?.[2].next, expectedTopicMenu(id));
      return answer.messages[0];
    });
  }

  assert.equal(localeQuestionLabels.en.length, localeQuestionLabels.ko.length);
  assert.notDeepEqual(localeQuestionLabels.en, localeQuestionLabels.ko);
});

test("role-specific topic trees use grouped branches where needed", () => {
  for (const locale of ["en", "ko"] as const) {
    const flow = buildSupportFlow(locale);
    for (const topic of ["account", "messages", "dm", "reports", "live"]) {
      const topicMenu = flow[`${topic}-questions`];
      const groupedChoices = topicMenu.choices?.filter((choice) => choice.id.startsWith(`group-user-${topic}-`)) || [];
      assert.ok(groupedChoices.length > 0);
      assert.ok(groupedChoices.every((choice) => flow[choice.next]?.kind === "choice"));
    }
    for (const topic of ["access", "info"]) {
      const choices = flow[`${topic}-questions`].choices || [];
      assert.ok(choices.some((choice) => choice.id.startsWith("question-")));
      assert.ok(choices.every((choice) => choice.id.startsWith("question-") || choice.id.startsWith("back-")));
    }
    for (const topic of ["account", "dm", "reports", "live"]) {
      const topicMenu = flow[`admin-${topic}-questions`];
      const groupedChoices = topicMenu.choices?.filter((choice) => choice.id.startsWith(`group-admin-${topic}-`)) || [];
      assert.ok(groupedChoices.length > 0);
      assert.ok(groupedChoices.every((choice) => flow[choice.next]?.kind === "choice"));
    }
    for (const topic of ["access", "messages", "info"]) {
      const choices = flow[`admin-${topic}-questions`].choices || [];
      assert.ok(choices.some((choice) => choice.id.startsWith("question-")));
      assert.ok(choices.every((choice) => choice.id.startsWith("question-") || choice.id.startsWith("back-")));
    }

    const freezingChoice = flow["reports-questions"].choices?.find(
      (choice) => choice.id === "group-user-reports-freezing",
    );
    assert.equal(freezingChoice?.next, "reports-freezing-questions");
    const freezingQuestionIds = flow["reports-freezing-questions"].choices
      ?.filter((choice) => choice.id.startsWith("question-"))
      .map((choice) => choice.id.replace(/^question-/, ""));
    assert.deepEqual(freezingQuestionIds, [
      "what-is-freeze",
      "who-can-freeze",
      "channel-frozen",
      "send-while-frozen",
      "dm-while-frozen",
      "frozen-history",
      "unfreeze-channel",
    ]);
  }
});

test("every current guided-support transition resolves to a valid node", () => {
  for (const locale of ["en", "ko"] as const) {
    const flow = buildSupportFlow(locale);
    const pending = ["start"];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const nodeId = pending.pop() as string;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = flow[nodeId];
      assert.ok(node, `${locale} flow is missing ${nodeId}`);

      for (const choice of node.choices || []) {
        assert.ok(flow[choice.next], `${locale} choice ${choice.id} targets missing ${choice.next}`);
        pending.push(choice.next);
      }
      const textTarget = followTextNode(node);
      if (textTarget) {
        assert.ok(flow[textTarget], `${locale} text node ${node.id} targets missing ${textTarget}`);
        pending.push(textTarget);
      }
    }

    for (const topic of TOPICS) {
      assert.ok(visited.has("user-topics"));
      assert.ok(visited.has("admin-topics"));
      assert.ok(visited.has(`${topic}-questions`));
      assert.ok(visited.has(`${topic}-details`));
      assert.ok(visited.has(`${topic}-escalate`));
      assert.ok(visited.has(`admin-${topic}-questions`));
      assert.ok(visited.has(`admin-${topic}-details`));
      assert.ok(visited.has(`admin-${topic}-escalate`));
    }
    assert.ok(visited.has("other-details"));
    assert.ok(visited.has("other-escalate"));
    assert.ok(visited.has("admin-other-details"));
    assert.ok(visited.has("admin-other-escalate"));
    const diagnosticQuestionTargets: Record<string, string> = {
      "notifications-not-arriving": "notification-login-check",
      "admin-notifications-not-arriving": "admin-notification-login-check",
      "live-notification-missing": "live-notification-login-check",
    };

    for (const questionId of EXPECTED_QUESTION_IDS) {
      const diagnosticTarget = diagnosticQuestionTargets[questionId];
      assert.ok(
        visited.has(diagnosticTarget || `answer-${questionId}`),
        `${locale} flow does not reach ${questionId}`,
      );
    }
  }
});

test("only unresolved questions enter free text and operator escalation", () => {
  const flow = buildSupportFlow("en");

  for (const questionId of EXPECTED_QUESTION_IDS) {
    const answer = flow[`answer-${questionId}`];
    const [resolved, needsHelp, back] = answer.choices || [];
    assert.equal(flow[resolved.next].kind, "terminal");
    assert.equal(flow[needsHelp.next].kind, "text");
    assert.equal(flow[back.next].id, expectedTopicMenu(questionId));
  }

  for (const topic of [...TOPICS, "other"] as const) {
    const details = flow[`${topic}-details`];
    const escalation = flow[`${topic}-escalate`];
    assert.equal(details.kind, "text");
    assert.equal(escalation.kind, "escalate");
    assert.equal(escalation.resolution, "needs_handoff");
  }
  for (const topic of [...TOPICS, "other"] as const) {
    const details = flow[`admin-${topic}-details`];
    const escalation = flow[`admin-${topic}-escalate`];
    assert.equal(details.kind, "text");
    assert.equal(escalation.kind, "escalate");
    assert.equal(escalation.resolution, "needs_handoff");
  }
});

test("deployment retains old session nodes and permits topic changes after going back", () => {
  const flow = buildSupportFlow("en");
  for (const topic of ["login", "passcode", "blocked", "reports", "live"]) {
    assert.ok(flow[`${topic}-steps`]);
    assert.ok(flow[`${topic}-details`]);
    assert.ok(flow[`${topic}-escalate`]);
  }
  assert.match(
    supportRouteSource,
    /nextEntryTopic = choice\.topic \|\| nextEntryTopic \|\| null/,
  );
});
