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

const EXPECTED_QUESTION_IDS = [
  "signup",
  "create-channel",
  "channel-account-required",
  "change-language",
  "change-font-size",
  "change-bubble-color",
  "personal-settings-scope",
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
  "channel-rules",
  "notice-meaning",
  "notice-reappeared",
  "behavior-changed",
  "status-banner",
] as const;

function followTextNode(node: SupportNode): string | null {
  return node.kind === "text"
    ? node.id.replace(/-details$/, "-escalate")
    : null;
}

test("guided support exposes every user-guide question in both locales", () => {
  const localeQuestionLabels: Record<string, string[]> = {};

  for (const locale of ["en", "ko"] as const) {
    const flow = buildSupportFlow(locale);
    assert.equal(flow.start.choices?.length, TOPICS.length + 1);

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
      assert.equal(answer.choices?.[2].next, "start");
      return answer.messages[0];
    });
  }

  assert.equal(localeQuestionLabels.en.length, localeQuestionLabels.ko.length);
  assert.notDeepEqual(localeQuestionLabels.en, localeQuestionLabels.ko);
});

test("long topics use intermediate menus and freezing has a dedicated branch", () => {
  for (const locale of ["en", "ko"] as const) {
    const flow = buildSupportFlow(locale);
    for (const topic of ["account", "messages", "dm", "reports", "live"]) {
      const topicMenu = flow[`${topic}-questions`];
      assert.ok(topicMenu.choices?.every((choice) => choice.id.startsWith(`group-${topic}-`)));
      assert.ok(topicMenu.choices?.every((choice) => flow[choice.next]?.kind === "choice"));
    }
    for (const topic of ["access", "info"]) {
      assert.ok(flow[`${topic}-questions`].choices?.every((choice) => choice.id.startsWith("question-")));
    }

    const freezingChoice = flow["reports-questions"].choices?.find(
      (choice) => choice.id === "group-reports-freezing",
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
      assert.ok(visited.has(`${topic}-questions`));
      assert.ok(visited.has(`${topic}-details`));
      assert.ok(visited.has(`${topic}-escalate`));
    }
    for (const questionId of EXPECTED_QUESTION_IDS) {
      assert.ok(visited.has(`answer-${questionId}`));
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
    assert.equal(flow[back.next].id, "start");
  }

  for (const topic of [...TOPICS, "other"] as const) {
    const details = flow[`${topic}-details`];
    const escalation = flow[`${topic}-escalate`];
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
