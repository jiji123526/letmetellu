import type { LocaleKeys } from "./ko";

export const en: Record<LocaleKeys, string> = {
  // Common
  cancel: "Cancel",
  confirm: "OK",
  save: "Save",
  close: "Close",
  delete: "Delete",
  send: "Send",

  // Chat
  deletedMessage: "This message was deleted",
  photo: "Photo",
  reply: "Reply",
  report: "Report",
  unreport: "Unreport",
  edit: "Edit",
  block: "Block User",
  unblock: "Unblock",
  messageInput: "Type a message",
  frozenInput: "Chat is frozen",
  blockedInput: "You are blocked",
  petitionInput: "Appeal (one-time only)",

  // Banners
  sentToAdmin: "Sent to admin",
  petitionSent: "Appeal has been sent",
  messageTooLong: "Message too long (max 5000 chars)",
  bannedWord: "Message contains a banned word",
  rateLimited: "Sending too fast",
  blocked: "You are blocked from sending",
  chatFrozen: "Chat is frozen",
  sendFailed: "Failed to send",
  chatUnfrozen: "Chat unfrozen",
  adminModeOn: "Admin mode enabled",
  adminModeOff: "Admin mode disabled",
  nameChanged: "Channel name updated",
  profileChanged: "Profile image updated",
  rulesChanged: "Channel rules saved",
  welcomeChanged: "Welcome popup saved",
  noticePosted: "Notice posted",
  connectionLost: "Connection lost. Reconnecting...",
  reported: "Report submitted",
  unreported: "Report cancelled",
  messageDeleted: "Message deleted",
  unblocked: "User unblocked",
  chatFrozenEmoji: "Chat is frozen 🧊",
  petitionAllowed: "Appeals enabled",
  petitionBlocked: "Appeals disabled",
  dmAllowed: "DMs enabled",
  dmBlocked: "DMs disabled",
  edited: "(edited)",
  returnToAdmin: "Return",
  viewingAsUser: "Viewing as user",

  // Live mode
  liveStarted: "Live has started",
  liveEnded: "Live has ended",
  liveTitle: "Live",
  liveEnterTitle: "Start Live",
  liveEnterPlaceholder: "Enter live title",
  liveEndTitle: "End Live",
  liveEndMessage: "End live session?<br>All messages will be deleted.",
  liveEndBtn: "End",
  liveJoinTitle: "Live chat has started.",
  liveJoinDesc: "Would you like to join?<br>All messages are deleted when live ends.",
  liveJoin: "Join",
  liveDismiss: "No thanks",
  liveLeave: "Leave",
  liveBannerActive: "Live chat in progress",
  liveBannerJoined: "In live chat",
  liveEndedTitle: "Live Ended",
  liveEndedDesc: "Live chat has ended.",

  // Header menu
  settings: "Settings",
  gallery: "Gallery",
  links: "Links",
  adminSettings: "Admin Settings",
  search: "Search",

  // Settings panel
  fontSize: "Font Size",
  bubbleColor: "Bubble Color",
  customColor: "Custom Color",
  language: "Language",

  // Admin panel
  channel: "Channel",
  manage: "Manage",
  freezeChat: "Freeze Chat",
  unfreezeChat: "Unfreeze Chat",
  liveStart: "Start Live",
  liveStop: "End Live",
  guide: "Admin Guide",
  viewAsUser: "View as User",
  profile: "Profile",
  color: "Color",
  passcode: "Passcode",
  rules: "Rules",
  welcomePopup: "Welcome Popup",
  bannedWords: "Banned Words",
  blockedUsers: "Blocked Users",
  petition: "Appeals",
  dmToggle: "DM",
  addSection: "+ Add Section",
  emojiPresets: "Emoji Presets",
  add: "+ Add",

  // Gallery
  galleryEmpty: "No photos shared yet",
  galleryTitle: "Gallery",

  // Links
  linksEmpty: "No links shared",
  linksTitle: "Links",

  // Notice
  noticeTitle: "Channel Rules",

  // Welcome popup
  welcomeConfirm: "Got it",

  // Search
  searchPlaceholder: "Search",
  searchNoResults: "No results",

  // Plus menu
  photoBtn: "Send Photo",
  dmBtn: "Secret Message",
  dmBtnOff: "Switch to Normal",
  noticeBtn: "Post Notice",
  emojiPresetBtn: "Emoji Presets",

  // Login
  appName: "letsplay",
  appDesc: "Create your own anonymous chat room",
  loginTab: "Log In",
  signupTab: "Sign Up",
  email: "Email",
  password: "Password",
  loginBtn: "Log In",
  signupBtn: "Sign Up",
  googleLogin: "Continue with Google",
  loginError: "Invalid email or password",
  signupError: "Failed to sign up",
  userExists: "Email already registered",
  weakPassword: "Password must be 8+ chars with a number",
  allFieldsRequired: "All fields are required",
  invalidEmail: "Enter a valid email",

  // Dashboard
  dashboardTitle: "My Channels",
  createChannel: "Create New Channel",
  channelSlug: "Channel URL",
  channelName: "Channel Name",
  create: "Create",
  logout: "Log Out",

  // Onboarding
  onboardingTitle: "Create Channel",
  onboardingStep1: "Channel Info",
  onboardingStep2: "Admin Guide",
  onboardingComplete: "Get Started",
  onboardingGuideDesc: "Learn about admin features.",
};
