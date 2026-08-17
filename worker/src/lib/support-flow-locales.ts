import type { UserLocale } from "./channel-moderation";
import type { GuidedSupportTopic, SupportAudience, SupportTopic } from "./support-flow";

export interface SupportQuestionCopy {
  id: string;
  label: string;
  answer: string;
}

export interface SupportQuestionGroupCopy {
  id: string;
  label: string;
  questionIds: string[];
}

interface SupportFlowLocaleStrings {
  topicLabels: Record<SupportTopic, string>;
  defaultTopicLabel: string;
  audienceLabels: Record<SupportAudience, string>;
  resolvedChoice: string;
  needHelpChoice: string;
  backToTopicsChoice: string;
  startMessage: string;
  topicPrompt: (audience: SupportAudience) => string;
  questionPrompt: string;
  groupPrompt: string;
  backChoice: string;
  questionGroups: Record<SupportAudience, Record<GuidedSupportTopic, SupportQuestionGroupCopy[]>>;
  questions: Record<SupportAudience, Record<GuidedSupportTopic, SupportQuestionCopy[]>>;
  legacyStepMessages: Record<"login" | "passcode" | "blocked" | "reports" | "live", string>;
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
      account: "Account, channel, or display",
      access: "Channel access",
      messages: "Messages or reactions",
      dm: "Private messages",
      reports: "Reports or restrictions",
      live: "Live chat",
      info: "Channel information",
      other: "Other",
      login: "Login or account",
      passcode: "Passcode or access",
      blocked: "Blocked or frozen",
    },
    defaultTopicLabel: "Support",
    audienceLabels: {
      user: "Visitor or normal user",
      admin: "Channel admin",
    },
    resolvedChoice: "That answered my question",
    needHelpChoice: "I still need help",
    backToTopicsChoice: "Back to topics",
    startMessage: "Is this for a channel admin or a normal user?",
    topicPrompt: (audience) => audience === "admin"
      ? "What does the admin need help with?"
      : "What do you need help with?",
    questionPrompt: "Choose the question closest to yours.",
    groupPrompt: "What do you need help with here?",
    backChoice: "Back",
    questionGroups: {
      user: {
        account: [
          { id: "getting-started", label: "Sign up or create a channel", questionIds: ["signup", "create-channel", "channel-account-required"] },
          { id: "display", label: "Language, font, or bubble color", questionIds: ["change-language", "change-font-size", "change-bubble-color", "personal-settings-scope"] },
          { id: "navigation", label: "Guide or channel menus", questionIds: ["reopen-guide", "find-channel-menu"] },
        ],
        access: [],
        messages: [
          { id: "reply-reaction", label: "Replies or reactions", questionIds: ["reply", "reaction", "different-emoji", "long-press-menu"] },
          { id: "edit-delete", label: "Edit or delete messages", questionIds: ["edit-own", "delete-own", "edit-others"] },
        ],
        dm: [
          { id: "send", label: "Send or find private messages", questionIds: ["send-dm", "dm-unavailable"] },
          { id: "privacy", label: "Privacy and saved DMs", questionIds: ["dm-visibility", "find-sent-dms", "other-visitors"] },
          { id: "replies", label: "Owner replies or deletion", questionIds: ["read-owner-replies", "reply-to-owner", "new-dm-required", "delete-dm-thread"] },
        ],
        reports: [
          { id: "reporting", label: "Report a message or channel", questionIds: ["report-message", "cancel-message-report", "report-channel", "report-difference"] },
          { id: "blocks-appeals", label: "Blocks and appeals", questionIds: ["cannot-send", "know-blocked", "what-is-appeal", "when-appeal", "appeal-block", "one-appeal"] },
          { id: "freezing", label: "Channel freezing", questionIds: ["what-is-freeze", "who-can-freeze", "channel-frozen", "send-while-frozen", "dm-while-frozen", "frozen-history", "unfreeze-channel"] },
        ],
        live: [
          { id: "basics", label: "Live chat basics", questionIds: ["what-is-live", "live-separate", "normal-messages-live", "live-duration"] },
          { id: "ended", label: "Ended live sessions", questionIds: ["live-messages-disappeared", "recover-live", "ended-live-send"] },
        ],
        info: [],
      },
      admin: {
        account: [
          { id: "setup", label: "Create or open admin tools", questionIds: ["admin-create-channel", "admin-channel-limit", "admin-open-admin-settings"] },
          { id: "appearance", label: "Profile, color, or background", questionIds: ["admin-edit-profile", "admin-change-default-color", "admin-change-background", "admin-profile-visibility"] },
          { id: "welcome", label: "Welcome popup or onboarding", questionIds: ["admin-edit-welcome", "admin-visitor-onboarding"] },
        ],
        access: [],
        messages: [],
        dm: [
          { id: "availability", label: "Turn DMs on or off", questionIds: ["admin-enable-dm", "admin-disable-dm", "admin-dm-disabled-for-visitors"] },
          { id: "replies", label: "Replying and attachments", questionIds: ["admin-reply-dm", "admin-dm-reply-photo", "admin-delete-dm-reply", "admin-user-delete-dm-thread"] },
        ],
        reports: [
          { id: "reports", label: "Reports and blocked users", questionIds: ["admin-review-message-report", "admin-block-user", "admin-unblock-user", "admin-banned-words"] },
          { id: "appeals", label: "Appeals and channel moderation", questionIds: ["admin-enable-appeals", "admin-review-appeal", "admin-channel-reported", "admin-platform-freeze"] },
          { id: "freezing", label: "Freeze and unfreeze chat", questionIds: ["admin-freeze-chat", "admin-unfreeze-chat", "admin-frozen-dm"] },
        ],
        live: [
          { id: "start", label: "Start or manage live", questionIds: ["admin-start-live", "admin-live-separate", "admin-live-emoji", "admin-live-duration"] },
          { id: "ending", label: "End of session", questionIds: ["admin-end-live", "admin-live-history"] },
        ],
        info: [],
      },
    },
    questions: {
      user: {
        account: [
          {
            id: "signup",
            label: "How do I sign up?",
            answer: "Open the dashboard login window, choose Sign Up, then use Google or verify your email.",
          },
          {
            id: "create-channel",
            label: "How do I create a channel?",
            answer: "Sign in and select the blue + button on the dashboard. Enter a channel name and address.",
          },
          {
            id: "channel-account-required",
            label: "Do I need an account to create a channel?",
            answer: "Yes. Creating and managing a channel requires a signed-in account.",
          },
          {
            id: "change-language",
            label: "How do I change the language?",
            answer: "Open the top-right ⋮ menu, choose Settings, and change Language.",
          },
          {
            id: "change-font-size",
            label: "How do I change the font size?",
            answer: "Open the top-right ⋮ menu, choose Settings, and adjust Font Size.",
          },
          {
            id: "change-bubble-color",
            label: "How do I change my bubble color?",
            answer: "Open the top-right ⋮ menu, choose Settings, and select your bubble color.",
          },
          {
            id: "personal-settings-scope",
            label: "Do these settings affect everyone or only me?",
            answer: "Language, font size, and your bubble color affect only your view.",
          },
          {
            id: "reopen-guide",
            label: "Where can I reopen the user guide?",
            answer: "Select the help button at the bottom-left of the dashboard.",
          },
          {
            id: "find-channel-menu",
            label: "Where are Settings, Gallery, and Links?",
            answer: "Open the ⋮ menu in the top-right of the channel.",
          },
        ],
        access: [
          {
            id: "passcode-required",
            label: "Why is this channel asking for a passcode?",
            answer: "The owner protected the channel. Enter the current passcode to continue.",
          },
          {
            id: "passcode-again",
            label: "Why do I need to enter the passcode again?",
            answer: "Room access expired, or the owner changed the passcode. Enter the current passcode again.",
          },
          {
            id: "passcode-stopped",
            label: "The passcode stopped working. What should I do?",
            answer: "Ask the owner whether it changed, then try the latest passcode.",
          },
          {
            id: "find-passcode-hint",
            label: "How can I find the latest passcode or hint?",
            answer: "The entry screen shows the hint. Ask the owner for the passcode.",
          },
          {
            id: "lost-access-refresh",
            label: "Why did I lose access after refreshing?",
            answer: "Your room access expired or the passcode changed. Enter the latest passcode.",
          },
        ],
        messages: [
          {
            id: "reply",
            label: "How do I reply to a specific message?",
            answer: "Long-press the message and choose Reply.",
          },
          {
            id: "reaction",
            label: "How do I add a reaction?",
            answer: "Long-press the message and choose one of the quick reactions.",
          },
          {
            id: "different-emoji",
            label: "How do I choose a different emoji?",
            answer: "Long-press the message, open the emoji option, and choose an emoji.",
          },
          {
            id: "edit-own",
            label: "How do I edit my message?",
            answer: "Long-press your own message and choose Edit.",
          },
          {
            id: "delete-own",
            label: "How do I delete my message?",
            answer: "Long-press your own message and choose Delete.",
          },
          {
            id: "edit-others",
            label: "Can I edit or delete another person’s message?",
            answer: "No. Only the channel owner can delete another visitor’s message.",
          },
          {
            id: "long-press-menu",
            label: "Why does long-pressing open a message menu?",
            answer: "The long-press menu shows the actions available for that message.",
          },
        ],
        dm: [
          {
            id: "send-dm",
            label: "How do I send a private message to the owner?",
            answer: "Open the chat’s + menu and choose Private Message.",
          },
          {
            id: "dm-visibility",
            label: "Who can see my private message?",
            answer: "Only you in the same browser and the channel owner can see it.",
          },
          {
            id: "find-sent-dms",
            label: "Where can I see DMs I already sent?",
            answer: "They appear in the channel chat on the same browser.",
          },
          {
            id: "other-visitors",
            label: "Can other visitors see my DM?",
            answer: "No. Other visitors cannot see your DM thread.",
          },
          {
            id: "read-owner-replies",
            label: "How do I read the owner’s private replies?",
            answer: "They appear beneath your original DM in the same browser.",
          },
          {
            id: "reply-to-owner",
            label: "Can I reply directly to the owner’s reply?",
            answer: "No. Send a new private message instead.",
          },
          {
            id: "new-dm-required",
            label: "Why do I need to send a new DM to answer?",
            answer: "Each DM thread accepts replies only from the owner.",
          },
          {
            id: "delete-dm-thread",
            label: "How do I delete my whole DM thread?",
            answer: "Long-press your original DM and choose Delete.",
          },
          {
            id: "dm-unavailable",
            label: "Why is the private-message option unavailable?",
            answer: "The owner disabled DMs, or your current status prevents sending.",
          },
        ],
        reports: [
          {
            id: "report-message",
            label: "How do I report a specific message?",
            answer: "Long-press the message and choose Report.",
          },
          {
            id: "cancel-message-report",
            label: "How do I cancel a message report?",
            answer: "Long-press the reported message and choose Unreport.",
          },
          {
            id: "report-channel",
            label: "How do I report the entire channel?",
            answer: "Open the top-right ⋮ menu and choose Report Channel.",
          },
          {
            id: "report-difference",
            label: "What is the difference between message and channel reports?",
            answer: "Message reports go to the owner. Channel reports go to platform moderation.",
          },
          {
            id: "cannot-send",
            label: "Why can’t I send messages?",
            answer: "Read the message shown near the chat input. It explains whether you are blocked or the channel is frozen.",
          },
          {
            id: "know-blocked",
            label: "How do I know whether I was blocked?",
            answer: "The chat shows a blocked message and stops your messages.",
          },
          {
            id: "what-is-appeal",
            label: "What is an appeal?",
            answer: "An appeal is a one-time request to review a restriction.",
          },
          {
            id: "when-appeal",
            label: "When can I submit an appeal?",
            answer: "You can submit one when the restricted screen shows an appeal option.",
          },
          {
            id: "appeal-block",
            label: "Can I appeal a block?",
            answer: "Yes, if the owner enabled appeals. Use the input shown in the blocked screen.",
          },
          {
            id: "one-appeal",
            label: "Why can I submit only one appeal?",
            answer: "The limit prevents appeals from becoming another way to message after a restriction.",
          },
          {
            id: "what-is-freeze",
            label: "What does freezing a channel do?",
            answer: "Freezing pauses regular visitor messages. The channel stays visible.",
          },
          {
            id: "who-can-freeze",
            label: "Who can freeze a channel?",
            answer: "The channel owner can pause their channel. The platform can also freeze it for moderation.",
          },
          {
            id: "channel-frozen",
            label: "Why is the whole channel frozen?",
            answer: "The owner paused it, or platform moderation restricted it. The chat will show that the channel is frozen.",
          },
          {
            id: "send-while-frozen",
            label: "Who can send messages while a channel is frozen?",
            answer: "During an owner pause, only the owner can post. A platform freeze also blocks the owner.",
          },
          {
            id: "dm-while-frozen",
            label: "Can private messages work while a channel is frozen?",
            answer: "Yes, if the channel owner keeps private messages enabled.",
          },
          {
            id: "frozen-history",
            label: "Are old messages deleted when a channel is frozen?",
            answer: "No. Freezing pauses new visitor messages but keeps the existing chat history.",
          },
          {
            id: "unfreeze-channel",
            label: "Who can unfreeze a channel?",
            answer: "The owner can end their own freeze. A platform freeze requires platform review.",
          },
        ],
        live: [
          {
            id: "what-is-live",
            label: "What is live chat?",
            answer: "Live chat is a temporary session opened by the channel owner.",
          },
          {
            id: "live-separate",
            label: "Is live chat separate from normal chat?",
            answer: "Yes. Live messages are separate from regular chat history.",
          },
          {
            id: "normal-messages-live",
            label: "Where did my normal messages go during live mode?",
            answer: "They remain in regular chat. Leave live mode to see them.",
          },
          {
            id: "live-messages-disappeared",
            label: "Why did live messages disappear?",
            answer: "Live messages are deleted when the session ends.",
          },
          {
            id: "recover-live",
            label: "Can I recover messages after live ends?",
            answer: "No. Ended live messages are permanently deleted.",
          },
          {
            id: "ended-live-send",
            label: "Why can’t I send to an ended live session?",
            answer: "Ended live sessions no longer accept messages or reactions.",
          },
          {
            id: "live-duration",
            label: "How long can a live session remain open?",
            answer: "A live session can remain open for up to eight hours.",
          },
        ],
        info: [
          {
            id: "channel-rules",
            label: "Where can I read the channel rules?",
            answer: "Select the information button in the channel header.",
          },
          {
            id: "notice-meaning",
            label: "What does the notice banner mean?",
            answer: "It is an announcement posted by the channel owner above chat.",
          },
          {
            id: "notice-reappeared",
            label: "Why did a new notice appear after I dismissed the previous one?",
            answer: "A changed or new notice appears again after the old one was dismissed.",
          },
          {
            id: "behavior-changed",
            label: "What should I check when channel behavior suddenly changes?",
            answer: "Check the notice and channel rules first.",
          },
        ],
      },
      admin: {
        account: [
          {
            id: "admin-create-channel",
            label: "How do I create a new channel?",
            answer: "Sign in on the dashboard and select the blue + button to create a new channel.",
          },
          {
            id: "admin-channel-limit",
            label: "Why can’t I create another channel?",
            answer: "Each account can manage up to five channels. Delete one before creating another.",
          },
          {
            id: "admin-open-admin-settings",
            label: "Where do I open admin settings?",
            answer: "Open a channel, choose the top-right ⋮ menu, open Settings, then select Admin Settings.",
          },
          {
            id: "admin-edit-profile",
            label: "How do I change the channel name or photo?",
            answer: "Open Admin Settings to change the channel name and profile image.",
          },
          {
            id: "admin-change-default-color",
            label: "How do I change the default bubble color?",
            answer: "Open Admin Settings to choose the channel’s default bubble color.",
          },
          {
            id: "admin-change-background",
            label: "How do I change the chat background?",
            answer: "Open Channel Settings in Admin Settings to set a solid background or image.",
          },
          {
            id: "admin-profile-visibility",
            label: "How do I show a channel on my admin profile?",
            answer: "Channels are private by default. Turn on profile visibility in Channel Settings to show them on your admin profile.",
          },
          {
            id: "admin-edit-welcome",
            label: "How do I edit the welcome popup?",
            answer: "Open Channel Settings in Admin Settings to edit the welcome popup image, title, and guide items.",
          },
          {
            id: "admin-visitor-onboarding",
            label: "What do first-time visitors see?",
            answer: "First-time visitors see your welcome popup, then they can reopen the user guide from the dashboard help button.",
          },
        ],
        access: [
          {
            id: "admin-set-passcode",
            label: "How do I add a passcode?",
            answer: "Open Channel Settings in Admin Settings, enter a passcode, and save.",
          },
          {
            id: "admin-remove-passcode",
            label: "How do I remove a passcode?",
            answer: "Save an empty passcode in Channel Settings to remove passcode protection.",
          },
          {
            id: "admin-passcode-hint",
            label: "How do I add or change the passcode hint?",
            answer: "Add or edit the public passcode hint in the same Channel Settings section.",
          },
          {
            id: "admin-passcode-repeat",
            label: "Why are visitors asked for the passcode again?",
            answer: "Visitors are asked again when room access expires or when you change the passcode.",
          },
          {
            id: "admin-visitor-access-failed",
            label: "What should I check when a visitor can’t enter?",
            answer: "Confirm the current passcode and hint, then ask the visitor to retry with the latest passcode.",
          },
        ],
        messages: [
          {
            id: "admin-reply-message",
            label: "How do I reply to a message?",
            answer: "Long-press any message and choose Reply.",
          },
          {
            id: "admin-react-message",
            label: "How do I add a reaction?",
            answer: "Long-press a message to add one of the quick reactions or open the emoji picker.",
          },
          {
            id: "admin-edit-own-message",
            label: "How do I edit my own message?",
            answer: "Long-press your own message and choose Edit.",
          },
          {
            id: "admin-delete-visitor-message",
            label: "How do I delete a visitor’s message?",
            answer: "Long-press the visitor message and choose Delete.",
          },
          {
            id: "admin-message-menu",
            label: "Why does long-press open a message menu?",
            answer: "The long-press menu shows the actions available for that message.",
          },
        ],
        dm: [
          {
            id: "admin-enable-dm",
            label: "How do I turn private messages on?",
            answer: "Open Manage in Admin Settings and turn Private Messages on.",
          },
          {
            id: "admin-disable-dm",
            label: "How do I turn private messages off?",
            answer: "Open Manage in Admin Settings and turn Private Messages off.",
          },
          {
            id: "admin-dm-disabled-for-visitors",
            label: "What happens when private messages are off?",
            answer: "Visitors cannot open new private-message threads while Private Messages is off.",
          },
          {
            id: "admin-reply-dm",
            label: "How do I reply to a visitor DM?",
            answer: "Long-press the visitor’s original DM and choose Reply.",
          },
          {
            id: "admin-dm-reply-photo",
            label: "Can I attach a photo to a DM reply?",
            answer: "Each DM reply can include text and up to one photo.",
          },
          {
            id: "admin-delete-dm-reply",
            label: "How do I delete my DM reply?",
            answer: "Long-press your DM reply and choose Delete.",
          },
          {
            id: "admin-user-delete-dm-thread",
            label: "Can visitors delete their own DM thread?",
            answer: "Yes. Visitors can long-press their original DM and delete the whole thread.",
          },
        ],
        reports: [
          {
            id: "admin-review-message-report",
            label: "Where do I review message reports?",
            answer: "Reported messages appear to the admin with a 🚨 marker so you can review them in chat.",
          },
          {
            id: "admin-block-user",
            label: "How do I block a user?",
            answer: "Long-press one of the user’s messages and choose Block.",
          },
          {
            id: "admin-unblock-user",
            label: "How do I unblock a user?",
            answer: "Open User Management in Admin Settings and remove the block from the blocked-user list.",
          },
          {
            id: "admin-banned-words",
            label: "Where do I manage blocked words?",
            answer: "Set blocked words under Manage to stop messages containing those words automatically.",
          },
          {
            id: "admin-enable-appeals",
            label: "How do I turn appeals on or off?",
            answer: "Open Manage in Admin Settings and turn Appeals on or off.",
          },
          {
            id: "admin-review-appeal",
            label: "Where do I review a blocked user appeal?",
            answer: "Blocked-user appeals appear in chat for you to review once the user submits them.",
          },
          {
            id: "admin-channel-reported",
            label: "What happens if my channel is reported?",
            answer: "If the channel is reported, platform moderation can warn or freeze it and may let you submit one appeal.",
          },
          {
            id: "admin-platform-freeze",
            label: "What does a platform freeze mean for admins?",
            answer: "A platform freeze blocks even the admin until platform moderation reviews the channel.",
          },
          {
            id: "admin-freeze-chat",
            label: "How do I freeze chat?",
            answer: "Use the admin menu to freeze chat when you need to pause visitor messages.",
          },
          {
            id: "admin-unfreeze-chat",
            label: "How do I unfreeze chat?",
            answer: "Use the same admin menu to unfreeze chat when you are ready.",
          },
          {
            id: "admin-frozen-dm",
            label: "Do private messages still work during my freeze?",
            answer: "Visitors can still send DMs during your own freeze only if Private Messages remains enabled.",
          },
        ],
        live: [
          {
            id: "admin-start-live",
            label: "How do I start a live session?",
            answer: "Use the + menu in chat to start a live session.",
          },
          {
            id: "admin-live-separate",
            label: "Is live separate from normal chat?",
            answer: "Yes. Live chat is separate from regular chat history.",
          },
          {
            id: "admin-live-emoji",
            label: "Where do I set live emoji presets?",
            answer: "Choose the live session’s emoji presets when you start the session.",
          },
          {
            id: "admin-live-duration",
            label: "How long can live stay open?",
            answer: "A live session can remain open for up to eight hours.",
          },
          {
            id: "admin-end-live",
            label: "How do I end a live session?",
            answer: "End the live session from live mode when you are done.",
          },
          {
            id: "admin-live-history",
            label: "What happens to messages after live ends?",
            answer: "Ended live messages are deleted and do not return to regular chat history.",
          },
        ],
        info: [
          {
            id: "admin-edit-rules",
            label: "How do I edit channel rules?",
            answer: "Open Channel Settings in Admin Settings to edit the rules visitors open from the information button.",
          },
          {
            id: "admin-post-notice",
            label: "How do I post a notice above chat?",
            answer: "Use the admin notice editor to post a dismissible notice above chat.",
          },
          {
            id: "admin-notice-reappears",
            label: "Why does a notice show again after dismissal?",
            answer: "A new or changed notice appears again even if the previous notice was dismissed.",
          },
          {
            id: "admin-where-users-see-info",
            label: "Where do visitors see rules and notices?",
            answer: "Visitors can open channel rules from the information button and see notices above chat when you post them.",
          },
        ],
      },
    },
    legacyStepMessages: {
      login: "Use the same login method you used when you signed up. Email users can reset their password from the dashboard.",
      passcode: "Ask the owner whether the passcode changed, use the latest shared link, and refresh once before trying the current passcode again.",
      blocked: "Read the block reason or notice shown in chat. If a one-time appeal is available, send it from the chat input.",
      reports: "Report one message from its long-press menu, or report the whole channel from the top-right menu.",
      live: "Live chat is separate from regular chat, and its messages are deleted when the session ends.",
    },
    resolvedMessage: "Your guided-support question is closed. You can start again if you need help with something else.",
    textPlaceholder: "Describe the issue",
    textSubmitLabel: "Continue",
    escalationLabel: "Contact support",
    summaryTopicLabel: "Support topic",
    summaryPathLabel: "Guided path",
    summaryUserLabel: "User summary",
    textPrompt: (topicLabel) => `Describe what is still wrong with ${topicLabel.toLowerCase()}. Include what you tried and what you expected to happen.`,
    escalatePrompt: (topicLabel) => `I can send this ${topicLabel.toLowerCase()} case to the platform support inbox with your summary attached.`,
  },
  ko: {
    topicLabels: {
      account: "계정, 채널 만들기 또는 화면 설정",
      access: "채널 입장",
      messages: "메시지 또는 리액션",
      dm: "비밀 메시지",
      reports: "신고 또는 이용 제한",
      live: "라이브 채팅",
      info: "채널 안내",
      other: "기타",
      login: "로그인 또는 계정",
      passcode: "비밀번호 또는 입장",
      blocked: "차단 또는 동결",
    },
    defaultTopicLabel: "고객지원",
    audienceLabels: {
      user: "일반 사용자",
      admin: "방장",
    },
    resolvedChoice: "궁금한 점이 해결됐어요",
    needHelpChoice: "아직 도움이 필요해요",
    backToTopicsChoice: "주제 목록으로",
    startMessage: "방장 문의인가요, 일반 사용자 문의인가요?",
    topicPrompt: (audience) => audience === "admin"
      ? "방장 기준으로 어떤 도움이 필요하신가요?"
      : "어떤 도움이 필요하신가요?",
    questionPrompt: "궁금한 내용과 가장 가까운 질문을 선택해 주세요.",
    groupPrompt: "어떤 내용이 궁금하신가요?",
    backChoice: "이전으로",
    questionGroups: {
      user: {
        account: [
          { id: "getting-started", label: "가입 또는 채널 만들기", questionIds: ["signup", "create-channel", "channel-account-required"] },
          { id: "display", label: "언어, 글자 또는 말풍선 색", questionIds: ["change-language", "change-font-size", "change-bubble-color", "personal-settings-scope"] },
          { id: "navigation", label: "가이드 또는 채널 메뉴", questionIds: ["reopen-guide", "find-channel-menu"] },
        ],
        access: [],
        messages: [
          { id: "reply-reaction", label: "답장 또는 리액션", questionIds: ["reply", "reaction", "different-emoji", "long-press-menu"] },
          { id: "edit-delete", label: "메시지 수정 또는 삭제", questionIds: ["edit-own", "delete-own", "edit-others"] },
        ],
        dm: [
          { id: "send", label: "비밀 메시지 보내기 또는 찾기", questionIds: ["send-dm", "dm-unavailable"] },
          { id: "privacy", label: "공개 범위와 저장된 DM", questionIds: ["dm-visibility", "find-sent-dms", "other-visitors"] },
          { id: "replies", label: "방장 답장 또는 삭제", questionIds: ["read-owner-replies", "reply-to-owner", "new-dm-required", "delete-dm-thread"] },
        ],
        reports: [
          { id: "reporting", label: "메시지 또는 채널 신고", questionIds: ["report-message", "cancel-message-report", "report-channel", "report-difference"] },
          { id: "blocks-appeals", label: "차단과 이의 제기", questionIds: ["cannot-send", "know-blocked", "what-is-appeal", "when-appeal", "appeal-block", "one-appeal"] },
          { id: "freezing", label: "채널 얼리기", questionIds: ["what-is-freeze", "who-can-freeze", "channel-frozen", "send-while-frozen", "dm-while-frozen", "frozen-history", "unfreeze-channel"] },
        ],
        live: [
          { id: "basics", label: "라이브 채팅 기본", questionIds: ["what-is-live", "live-separate", "normal-messages-live", "live-duration"] },
          { id: "ended", label: "종료된 라이브", questionIds: ["live-messages-disappeared", "recover-live", "ended-live-send"] },
        ],
        info: [],
      },
      admin: {
        account: [
          { id: "setup", label: "채널 만들기 또는 방장 설정 열기", questionIds: ["admin-create-channel", "admin-channel-limit", "admin-open-admin-settings"] },
          { id: "appearance", label: "프로필, 색상 또는 배경", questionIds: ["admin-edit-profile", "admin-change-default-color", "admin-change-background", "admin-profile-visibility"] },
          { id: "welcome", label: "환영 팝업 또는 첫 방문 안내", questionIds: ["admin-edit-welcome", "admin-visitor-onboarding"] },
        ],
        access: [],
        messages: [],
        dm: [
          { id: "availability", label: "DM 켜기 또는 끄기", questionIds: ["admin-enable-dm", "admin-disable-dm", "admin-dm-disabled-for-visitors"] },
          { id: "replies", label: "답장과 첨부", questionIds: ["admin-reply-dm", "admin-dm-reply-photo", "admin-delete-dm-reply", "admin-user-delete-dm-thread"] },
        ],
        reports: [
          { id: "reports", label: "신고와 차단 사용자", questionIds: ["admin-review-message-report", "admin-block-user", "admin-unblock-user", "admin-banned-words"] },
          { id: "appeals", label: "이의 제기와 운영 제한", questionIds: ["admin-enable-appeals", "admin-review-appeal", "admin-channel-reported", "admin-platform-freeze"] },
          { id: "freezing", label: "채널 얼리기와 해제", questionIds: ["admin-freeze-chat", "admin-unfreeze-chat", "admin-frozen-dm"] },
        ],
        live: [
          { id: "start", label: "라이브 시작과 관리", questionIds: ["admin-start-live", "admin-live-separate", "admin-live-emoji", "admin-live-duration"] },
          { id: "ending", label: "라이브 종료 후", questionIds: ["admin-end-live", "admin-live-history"] },
        ],
        info: [],
      },
    },
    questions: {
      user: {
        account: [
          {
            id: "signup",
            label: "어떻게 가입하나요?",
            answer: "대시보드의 로그인 창에서 가입하기를 선택하세요. Google 또는 이메일 인증으로 가입할 수 있습니다.",
          },
          {
            id: "create-channel",
            label: "채널은 어떻게 만드나요?",
            answer: "로그인하고 대시보드의 파란색 + 버튼을 누르세요. 채널 이름과 주소를 입력하면 됩니다.",
          },
          {
            id: "channel-account-required",
            label: "채널을 만들려면 계정이 필요한가요?",
            answer: "네. 채널을 만들고 관리하려면 로그인 계정이 필요합니다.",
          },
          {
            id: "change-language",
            label: "언어는 어떻게 바꾸나요?",
            answer: "오른쪽 위의 ⋮ 메뉴에서 설정을 열고 언어를 변경하세요.",
          },
          {
            id: "change-font-size",
            label: "글자 크기는 어떻게 바꾸나요?",
            answer: "오른쪽 위의 ⋮ 메뉴에서 설정을 열고 글자 크기를 조절하세요.",
          },
          {
            id: "change-bubble-color",
            label: "내 말풍선 색은 어떻게 바꾸나요?",
            answer: "오른쪽 위의 ⋮ 메뉴에서 설정을 열고 내 말풍선 색을 선택하세요.",
          },
          {
            id: "personal-settings-scope",
            label: "이 설정은 모두에게 적용되나요?",
            answer: "언어, 글자 크기, 내 말풍선 색은 내 화면에만 적용됩니다.",
          },
          {
            id: "reopen-guide",
            label: "사용자 가이드는 어디서 다시 여나요?",
            answer: "대시보드 왼쪽 아래의 도움말 버튼을 누르세요.",
          },
          {
            id: "find-channel-menu",
            label: "설정, 갤러리, 링크는 어디에 있나요?",
            answer: "채널 오른쪽 위의 ⋮ 메뉴를 여세요.",
          },
        ],
        access: [
          {
            id: "passcode-required",
            label: "왜 채널 비밀번호를 입력해야 하나요?",
            answer: "방장이 채널을 보호하고 있습니다. 현재 비밀번호를 입력하세요.",
          },
          {
            id: "passcode-again",
            label: "왜 비밀번호를 다시 입력해야 하나요?",
            answer: "입장 권한이 만료됐거나 비밀번호가 바뀌었습니다. 현재 비밀번호를 다시 입력하세요.",
          },
          {
            id: "passcode-stopped",
            label: "비밀번호가 갑자기 안 돼요.",
            answer: "방장에게 변경 여부를 확인한 뒤 최신 비밀번호를 입력하세요.",
          },
          {
            id: "find-passcode-hint",
            label: "최신 비밀번호나 힌트는 어디서 찾나요?",
            answer: "힌트는 입장 화면에 표시됩니다. 비밀번호는 방장에게 확인하세요.",
          },
          {
            id: "lost-access-refresh",
            label: "새로고침 후 왜 입장할 수 없나요?",
            answer: "입장 권한이 만료됐거나 비밀번호가 바뀌었습니다. 최신 비밀번호를 입력하세요.",
          },
        ],
        messages: [
          {
            id: "reply",
            label: "특정 메시지에 어떻게 답장하나요?",
            answer: "해당 메시지를 길게 누르고 답장을 선택하세요.",
          },
          {
            id: "reaction",
            label: "리액션은 어떻게 남기나요?",
            answer: "메시지를 길게 누른 뒤 기본 리액션 중 하나를 선택하세요.",
          },
          {
            id: "different-emoji",
            label: "다른 이모지는 어떻게 고르나요?",
            answer: "메시지를 길게 누르고 이모지 선택에서 원하는 이모지를 고르세요.",
          },
          {
            id: "edit-own",
            label: "내 메시지는 어떻게 수정하나요?",
            answer: "내가 보낸 메시지를 길게 누르고 수정을 선택하세요.",
          },
          {
            id: "delete-own",
            label: "내 메시지는 어떻게 삭제하나요?",
            answer: "내가 보낸 메시지를 길게 누르고 삭제를 선택하세요.",
          },
          {
            id: "edit-others",
            label: "다른 사람의 메시지도 수정하거나 삭제할 수 있나요?",
            answer: "아니요. 다른 방문자의 메시지는 방장만 삭제할 수 있습니다.",
          },
          {
            id: "long-press-menu",
            label: "메시지를 길게 누르면 왜 메뉴가 열리나요?",
            answer: "길게 누르기 메뉴에는 해당 메시지에서 사용할 수 있는 기능이 표시됩니다.",
          },
        ],
        dm: [
          {
            id: "send-dm",
            label: "방장에게 비밀 메시지를 어떻게 보내나요?",
            answer: "채팅의 + 메뉴에서 비밀 메시지를 선택하세요.",
          },
          {
            id: "dm-visibility",
            label: "내 비밀 메시지는 누가 볼 수 있나요?",
            answer: "같은 브라우저의 나와 채널 방장만 볼 수 있습니다.",
          },
          {
            id: "find-sent-dms",
            label: "전에 보낸 DM은 어디서 보나요?",
            answer: "같은 브라우저의 채널 채팅에 표시됩니다.",
          },
          {
            id: "other-visitors",
            label: "다른 방문자도 내 DM을 볼 수 있나요?",
            answer: "아니요. 다른 방문자는 내 DM 대화를 볼 수 없습니다.",
          },
          {
            id: "read-owner-replies",
            label: "방장의 비밀 답장은 어디서 읽나요?",
            answer: "같은 브라우저에서 원본 DM 아래에 표시됩니다.",
          },
          {
            id: "reply-to-owner",
            label: "방장의 답장에 바로 답할 수 있나요?",
            answer: "아니요. 대신 새 비밀 메시지를 보내세요.",
          },
          {
            id: "new-dm-required",
            label: "왜 답하려면 새 DM을 보내야 하나요?",
            answer: "각 DM 대화 안에서는 방장만 답장할 수 있기 때문입니다.",
          },
          {
            id: "delete-dm-thread",
            label: "DM 대화 전체는 어떻게 삭제하나요?",
            answer: "내가 보낸 원본 DM을 길게 누르고 삭제를 선택하세요.",
          },
          {
            id: "dm-unavailable",
            label: "왜 비밀 메시지 기능을 사용할 수 없나요?",
            answer: "방장이 DM을 껐거나 현재 상태에서 전송할 수 없습니다.",
          },
        ],
        reports: [
          {
            id: "report-message",
            label: "특정 메시지는 어떻게 신고하나요?",
            answer: "해당 메시지를 길게 누르고 신고를 선택하세요.",
          },
          {
            id: "cancel-message-report",
            label: "메시지 신고는 어떻게 취소하나요?",
            answer: "신고한 메시지를 길게 누르고 신고 취소를 선택하세요.",
          },
          {
            id: "report-channel",
            label: "채널 전체는 어떻게 신고하나요?",
            answer: "오른쪽 위의 ⋮ 메뉴에서 채널 신고를 선택하세요.",
          },
          {
            id: "report-difference",
            label: "메시지 신고와 채널 신고는 무엇이 다른가요?",
            answer: "메시지 신고는 방장에게, 채널 신고는 운영팀에 전달됩니다.",
          },
          {
            id: "cannot-send",
            label: "왜 메시지를 보낼 수 없나요?",
            answer: "채팅 입력창 근처에 표시되는 안내에서 차단 또는 동결 이유를 확인하세요.",
          },
          {
            id: "know-blocked",
            label: "차단됐는지 어떻게 알 수 있나요?",
            answer: "채팅에 차단 안내가 표시되고 메시지 전송이 중단됩니다.",
          },
          {
            id: "what-is-appeal",
            label: "이의 제기가 무엇인가요?",
            answer: "이의 제기는 이용 제한을 다시 검토해 달라는 1회성 요청입니다.",
          },
          {
            id: "when-appeal",
            label: "언제 이의 제기를 제출할 수 있나요?",
            answer: "이용 제한 화면에 이의 제기 기능이 표시될 때 한 번 제출할 수 있습니다.",
          },
          {
            id: "appeal-block",
            label: "차단에 이의 제기할 수 있나요?",
            answer: "방장이 허용한 경우 가능합니다. 차단 화면의 입력창을 사용하세요.",
          },
          {
            id: "one-appeal",
            label: "왜 이의 제기는 한 번만 가능한가요?",
            answer: "이의 제기가 이용 제한 뒤에도 계속 메시지를 보내는 수단이 되는 것을 막기 위해서입니다.",
          },
          {
            id: "what-is-freeze",
            label: "채널 얼리기는 어떤 기능인가요?",
            answer: "일반 방문자의 메시지 전송을 잠시 멈춥니다. 채널은 계속 볼 수 있습니다.",
          },
          {
            id: "who-can-freeze",
            label: "누가 채널을 얼릴 수 있나요?",
            answer: "방장이 채널을 잠시 얼릴 수 있습니다. 운영팀도 관리 목적으로 동결할 수 있습니다.",
          },
          {
            id: "channel-frozen",
            label: "왜 채널 전체가 얼려졌나요?",
            answer: "방장이 잠시 멈췄거나 운영 조치가 적용된 상태입니다. 채팅에서 동결 안내가 표시됩니다.",
          },
          {
            id: "send-while-frozen",
            label: "채널이 얼려지면 누가 메시지를 보낼 수 있나요?",
            answer: "방장이 얼린 경우 방장만 보낼 수 있습니다. 운영 동결은 방장도 전송할 수 없습니다.",
          },
          {
            id: "dm-while-frozen",
            label: "채널이 얼려져도 비밀 메시지를 보낼 수 있나요?",
            answer: "방장이 비밀 메시지를 켜 둔 경우에는 보낼 수 있습니다.",
          },
          {
            id: "frozen-history",
            label: "채널을 얼리면 이전 메시지가 삭제되나요?",
            answer: "아니요. 새 방문자 메시지만 멈추고 기존 채팅 기록은 그대로 유지됩니다.",
          },
          {
            id: "unfreeze-channel",
            label: "누가 채널 동결을 해제할 수 있나요?",
            answer: "방장이 얼린 채널은 방장이 해제합니다. 운영 동결은 운영팀 검토가 필요합니다.",
          },
        ],
        live: [
          {
            id: "what-is-live",
            label: "라이브 채팅이 무엇인가요?",
            answer: "라이브 채팅은 방장이 여는 임시 채팅 세션입니다.",
          },
          {
            id: "live-separate",
            label: "라이브 채팅은 일반 채팅과 별도인가요?",
            answer: "네. 라이브 메시지는 일반 채팅 기록과 분리됩니다.",
          },
          {
            id: "normal-messages-live",
            label: "라이브 중에 일반 메시지는 어디로 갔나요?",
            answer: "일반 채팅에 그대로 남아 있습니다. 라이브에서 나가면 볼 수 있습니다.",
          },
          {
            id: "live-messages-disappeared",
            label: "라이브 메시지는 왜 사라졌나요?",
            answer: "라이브 세션이 끝나면 메시지가 삭제됩니다.",
          },
          {
            id: "recover-live",
            label: "종료된 라이브 메시지를 복구할 수 있나요?",
            answer: "아니요. 종료된 라이브 메시지는 영구 삭제됩니다.",
          },
          {
            id: "ended-live-send",
            label: "종료된 라이브에 왜 메시지를 보낼 수 없나요?",
            answer: "종료된 라이브는 더 이상 메시지나 리액션을 받지 않습니다.",
          },
          {
            id: "live-duration",
            label: "라이브 세션은 얼마나 오래 열 수 있나요?",
            answer: "최대 8시간 동안 열 수 있습니다.",
          },
        ],
        info: [
          {
            id: "channel-rules",
            label: "채널 규칙은 어디서 읽나요?",
            answer: "채널 상단의 정보 버튼을 누르세요.",
          },
          {
            id: "notice-meaning",
            label: "공지 배너는 무엇인가요?",
            answer: "방장이 채팅 위에 게시한 안내입니다.",
          },
          {
            id: "notice-reappeared",
            label: "이전 공지를 닫았는데 왜 새 공지가 나타났나요?",
            answer: "방장이 내용을 바꾸거나 새 공지를 올리면 다시 표시됩니다.",
          },
          {
            id: "behavior-changed",
            label: "채널 동작이 갑자기 바뀌면 무엇을 확인해야 하나요?",
            answer: "현재 공지와 채널 규칙을 먼저 확인하세요.",
          },
        ],
      },
      admin: {
        account: [
          {
            id: "admin-create-channel",
            label: "새 채널은 어떻게 만드나요?",
            answer: "대시보드에서 로그인한 뒤 파란색 + 버튼을 눌러 새 채널을 만드세요.",
          },
          {
            id: "admin-channel-limit",
            label: "왜 채널을 더 만들 수 없나요?",
            answer: "계정당 최대 5개 채널을 관리할 수 있습니다. 새로 만들려면 기존 채널 하나를 삭제하세요.",
          },
          {
            id: "admin-open-admin-settings",
            label: "방장 설정은 어디서 여나요?",
            answer: "채널에서 오른쪽 위 ⋮ 메뉴를 열고 설정을 누른 뒤 아래의 방장 설정으로 들어가세요.",
          },
          {
            id: "admin-edit-profile",
            label: "채널 이름이나 사진은 어떻게 바꾸나요?",
            answer: "방장 설정에서 채널 이름과 프로필 이미지를 바꿀 수 있습니다.",
          },
          {
            id: "admin-change-default-color",
            label: "기본 말풍선 색은 어떻게 바꾸나요?",
            answer: "방장 설정에서 채널 기본 말풍선 색을 바꿀 수 있습니다.",
          },
          {
            id: "admin-change-background",
            label: "채팅 배경은 어떻게 바꾸나요?",
            answer: "방장 설정의 채널 설정에서 배경색이나 배경 이미지를 설정하세요.",
          },
          {
            id: "admin-profile-visibility",
            label: "내 프로필에 채널을 어떻게 노출하나요?",
            answer: "채널은 기본적으로 비공개입니다. 채널 설정에서 프로필 공개를 켜야 방장 프로필에 표시됩니다.",
          },
          {
            id: "admin-edit-welcome",
            label: "환영 팝업은 어떻게 수정하나요?",
            answer: "방장 설정의 채널 설정에서 환영 팝업 이미지, 제목, 안내 항목을 수정하세요.",
          },
          {
            id: "admin-visitor-onboarding",
            label: "처음 온 사용자는 무엇을 보나요?",
            answer: "처음 방문한 사용자는 환영 팝업을 보고, 이후에는 대시보드 도움말 버튼에서 사용자 가이드를 다시 열 수 있습니다.",
          },
        ],
        access: [
          {
            id: "admin-set-passcode",
            label: "비밀번호는 어떻게 설정하나요?",
            answer: "방장 설정의 채널 설정에서 비밀번호를 입력하고 저장하세요.",
          },
          {
            id: "admin-remove-passcode",
            label: "비밀번호는 어떻게 해제하나요?",
            answer: "채널 설정에서 비밀번호를 비운 채 저장하면 보호가 해제됩니다.",
          },
          {
            id: "admin-passcode-hint",
            label: "비밀번호 힌트는 어떻게 바꾸나요?",
            answer: "같은 채널 설정 구역에서 공개 힌트를 추가하거나 수정하세요.",
          },
          {
            id: "admin-passcode-repeat",
            label: "왜 사용자가 비밀번호를 다시 입력하나요?",
            answer: "입장 권한이 만료되었거나 방장이 비밀번호를 바꾸면 방문자는 다시 입력해야 합니다.",
          },
          {
            id: "admin-visitor-access-failed",
            label: "사용자가 입장하지 못할 때 무엇을 확인하나요?",
            answer: "현재 비밀번호와 힌트를 다시 확인하고 방문자에게 최신 비밀번호로 다시 시도해 달라고 안내하세요.",
          },
        ],
        messages: [
          {
            id: "admin-reply-message",
            label: "메시지에는 어떻게 답장하나요?",
            answer: "메시지를 길게 누르고 답장을 선택하세요.",
          },
          {
            id: "admin-react-message",
            label: "리액션은 어떻게 남기나요?",
            answer: "메시지를 길게 누르면 기본 리액션을 남기거나 이모지를 열 수 있습니다.",
          },
          {
            id: "admin-edit-own-message",
            label: "내 메시지는 어떻게 수정하나요?",
            answer: "내 메시지를 길게 누르고 수정을 선택하세요.",
          },
          {
            id: "admin-delete-visitor-message",
            label: "방문자 메시지는 어떻게 삭제하나요?",
            answer: "방문자 메시지를 길게 누르고 삭제를 선택하세요.",
          },
          {
            id: "admin-message-menu",
            label: "왜 길게 누르면 메뉴가 열리나요?",
            answer: "길게 누르기 메뉴에는 해당 메시지에서 가능한 기능이 표시됩니다.",
          },
        ],
        dm: [
          {
            id: "admin-enable-dm",
            label: "비밀 메시지는 어떻게 켜나요?",
            answer: "방장 설정의 관리 메뉴에서 비밀 메시지를 켜세요.",
          },
          {
            id: "admin-disable-dm",
            label: "비밀 메시지는 어떻게 끄나요?",
            answer: "방장 설정의 관리 메뉴에서 비밀 메시지를 끄세요.",
          },
          {
            id: "admin-dm-disabled-for-visitors",
            label: "비밀 메시지를 끄면 어떻게 되나요?",
            answer: "비밀 메시지를 끄면 방문자는 새 DM 대화를 시작할 수 없습니다.",
          },
          {
            id: "admin-reply-dm",
            label: "방문자 DM에는 어떻게 답장하나요?",
            answer: "방문자의 원본 DM을 길게 누르고 답장을 선택하세요.",
          },
          {
            id: "admin-dm-reply-photo",
            label: "DM 답장에 사진을 붙일 수 있나요?",
            answer: "DM 답장에는 텍스트와 사진 1장까지 넣을 수 있습니다.",
          },
          {
            id: "admin-delete-dm-reply",
            label: "내 DM 답장은 어떻게 삭제하나요?",
            answer: "내 DM 답장을 길게 누르고 삭제를 선택하세요.",
          },
          {
            id: "admin-user-delete-dm-thread",
            label: "사용자도 자기 DM 대화를 지울 수 있나요?",
            answer: "네. 방문자는 자신이 보낸 원본 DM을 길게 눌러 전체 대화를 삭제할 수 있습니다.",
          },
        ],
        reports: [
          {
            id: "admin-review-message-report",
            label: "메시지 신고는 어디서 확인하나요?",
            answer: "사용자가 신고한 메시지는 채팅에서 🚨 표시로 보여 방장이 검토할 수 있습니다.",
          },
          {
            id: "admin-block-user",
            label: "사용자는 어떻게 차단하나요?",
            answer: "사용자의 메시지를 길게 누르고 차단을 선택하세요.",
          },
          {
            id: "admin-unblock-user",
            label: "차단은 어떻게 해제하나요?",
            answer: "방장 설정의 사용자 관리에서 차단 목록을 열고 차단을 해제하세요.",
          },
          {
            id: "admin-banned-words",
            label: "금지어는 어디서 관리하나요?",
            answer: "관리 메뉴에서 금지어를 설정하면 해당 단어가 포함된 메시지를 자동으로 막을 수 있습니다.",
          },
          {
            id: "admin-enable-appeals",
            label: "이의 제기 허용은 어떻게 켜거나 끄나요?",
            answer: "방장 설정의 관리 메뉴에서 이의 제기 허용을 켜거나 끄세요.",
          },
          {
            id: "admin-review-appeal",
            label: "차단된 사용자의 이의 제기는 어디서 보나요?",
            answer: "차단된 사용자가 보낸 이의 제기는 채팅에 표시되며 방장이 한 번 검토할 수 있습니다.",
          },
          {
            id: "admin-channel-reported",
            label: "내 채널이 신고되면 어떻게 되나요?",
            answer: "채널이 신고되면 운영 경고나 동결이 적용될 수 있고, 필요한 경우 방장은 1회 이의 제기를 보낼 수 있습니다.",
          },
          {
            id: "admin-platform-freeze",
            label: "운영 동결은 방장에게 어떤 뜻인가요?",
            answer: "운영팀이 채널을 동결하면 방장도 메시지를 보낼 수 없고 운영 검토가 필요합니다.",
          },
          {
            id: "admin-freeze-chat",
            label: "채널은 어떻게 얼리나요?",
            answer: "방장 메뉴에서 채널을 얼려 방문자 메시지를 잠시 멈출 수 있습니다.",
          },
          {
            id: "admin-unfreeze-chat",
            label: "채널 얼리기는 어떻게 해제하나요?",
            answer: "같은 방장 메뉴에서 채널 얼리기를 해제할 수 있습니다.",
          },
          {
            id: "admin-frozen-dm",
            label: "내가 채널을 얼려도 DM은 계속 오나요?",
            answer: "방장이 직접 얼린 경우에만 비밀 메시지가 켜져 있으면 방문자 DM은 계속 받을 수 있습니다.",
          },
        ],
        live: [
          {
            id: "admin-start-live",
            label: "라이브는 어떻게 시작하나요?",
            answer: "채팅의 + 메뉴에서 라이브 세션을 시작하세요.",
          },
          {
            id: "admin-live-separate",
            label: "라이브는 일반 채팅과 별도인가요?",
            answer: "네. 라이브 채팅은 일반 채팅 기록과 분리됩니다.",
          },
          {
            id: "admin-live-emoji",
            label: "라이브 리액션 이모지는 어디서 고르나요?",
            answer: "라이브를 시작할 때 사용할 리액션 이모지 프리셋을 고를 수 있습니다.",
          },
          {
            id: "admin-live-duration",
            label: "라이브는 얼마나 오래 열 수 있나요?",
            answer: "라이브 세션은 최대 8시간까지 열어 둘 수 있습니다.",
          },
          {
            id: "admin-end-live",
            label: "라이브는 어떻게 종료하나요?",
            answer: "라이브 모드에서 세션 종료를 선택하면 됩니다.",
          },
          {
            id: "admin-live-history",
            label: "라이브가 끝나면 메시지는 어떻게 되나요?",
            answer: "종료된 라이브 메시지는 삭제되며 일반 채팅 기록으로 돌아오지 않습니다.",
          },
        ],
        info: [
          {
            id: "admin-edit-rules",
            label: "채널 규칙은 어떻게 수정하나요?",
            answer: "방장 설정의 채널 설정에서 정보 버튼에 표시될 규칙을 수정하세요.",
          },
          {
            id: "admin-post-notice",
            label: "채팅 위 공지는 어떻게 올리나요?",
            answer: "방장 공지 편집기에서 채팅 위에 표시되는 공지를 게시할 수 있습니다.",
          },
          {
            id: "admin-notice-reappears",
            label: "공지를 닫았는데 왜 다시 보이나요?",
            answer: "이전 공지를 닫았더라도 방장이 내용을 바꾸거나 새 공지를 올리면 다시 보입니다.",
          },
          {
            id: "admin-where-users-see-info",
            label: "사용자는 규칙과 공지를 어디서 보나요?",
            answer: "방문자는 정보 버튼에서 채널 규칙을 열고, 공지를 올리면 채팅 위에서 공지를 보게 됩니다.",
          },
        ],
      },
    },
    legacyStepMessages: {
      login: "가입할 때 사용한 로그인 방식으로 로그인해 주세요. 이메일 사용자는 대시보드에서 비밀번호를 재설정할 수 있습니다.",
      passcode: "방장에게 비밀번호 변경 여부를 확인하고 최신 링크에서 새로고침한 뒤 현재 비밀번호를 다시 입력해 주세요.",
      blocked: "차단 사유나 채팅 안내를 확인하세요. 1회 이의 제기가 표시되면 채팅 입력창에서 보낼 수 있습니다.",
      reports: "특정 메시지는 길게 눌러 신고하고, 채널 전체는 오른쪽 위 메뉴에서 신고할 수 있습니다.",
      live: "라이브는 일반 채팅과 별도이며 세션이 끝나면 라이브 메시지가 삭제됩니다.",
    },
    resolvedMessage: "안내를 종료했어요. 다른 도움이 필요하면 새로 시작할 수 있습니다.",
    textPlaceholder: "문제를 설명해 주세요",
    textSubmitLabel: "계속",
    escalationLabel: "운영팀에 문의",
    summaryTopicLabel: "문의 주제",
    summaryPathLabel: "안내 경로",
    summaryUserLabel: "사용자 설명",
    textPrompt: (topicLabel) => `${topicLabel}에서 아직 해결되지 않은 문제를 적어 주세요. 시도한 방법과 기대한 동작도 함께 알려주세요.`,
    escalatePrompt: (topicLabel) => `${topicLabel} 문의를 작성한 요약과 함께 운영팀 지원함으로 전달할 수 있습니다.`,
  },
};

export function getSupportFlowLocale(locale: UserLocale): SupportFlowLocaleStrings {
  return SUPPORT_FLOW_LOCALES[locale];
}
