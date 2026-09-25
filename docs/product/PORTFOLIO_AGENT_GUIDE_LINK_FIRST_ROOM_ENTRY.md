# Portfolio Agent Guide: Link-First Room Entry

This guide is for the agent building the portfolio demo. Assume you have zero access to the production app UI while implementing. Your job is to recreate the first interaction in a way that clearly reads as the real product, not a generic concept mock.

The product is `yap.`. Its first important interaction is simple: someone receives a shared room link, opens it, and enters an anonymous chat room immediately. There is no signup-first funnel. There is no browse/search-first funnel. The link is the front door.

## What This Demo Must Prove

The demo must communicate all of these points within a few seconds:

1. Entry starts from a shared `/ch/...` link.
2. Joining is anonymous by default.
3. Login is not required to read or chat.
4. Some rooms are open immediately.
5. Some rooms ask for a passcode, but only when the owner enabled it.
6. Once opened, the room feels like a real mobile chat product, not a landing page.
7. Return access is remembered on the same device only.

If the demo gets even one of these wrong, it stops resembling production behavior.

## Core Product Truths

Treat these as fixed rules:

- The room link is the primary invitation object.
- The room route is `/ch/{slug}`.
- A visitor opens the room directly, not via a dashboard-first flow.
- Anonymous identity is created automatically in the background.
- Passcode is conditional and owner-controlled.
- A protected room keeps the same room identity visible during passcode entry.
- Recent rooms are remembered locally on the same device.
- The product is mobile-first and visually close to iOS chat conventions.

## What Not To Build

Do not build any of the following:

- A marketing hero page before room entry.
- A search/discovery experience.
- Username or profile setup before entry.
- An email/login gate before room access.
- A Discord/Slack style left-sidebar layout.
- A dark, cyber, gaming, or neon visual language.
- A Dribbble-style speculative redesign that ignores the real app.

This demo should look like a clean, real, functioning messenger product.

## Visual Direction

The actual product uses a restrained iOS-native visual language.

### Overall Feel

- Bright, clean, lightweight.
- White background by default.
- Thin separators instead of heavy borders.
- Rounded cards and rounded avatars.
- Blue accent for actions and sent-message identity.
- Black primary text, muted gray metadata.
- Frosted header blur, not a flat colored app bar.
- System font stack, close to SF Pro / iOS.

### Typography

Use a system UI stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

Do not use expressive display fonts for this demo. Production does not.

### Production Color Tokens

Use these values directly:

```css
--bubble-sent: #3598fe;
--bubble-sent-hi: #2d7de0;
--gray-bubble: #e8e8ed;
--gray-text: #000000;
--bg: #ffffff;
--meta: #8e8e93;
--hairline: rgba(0, 0, 0, 0.12);
--header-bg: rgba(249, 249, 249, 0.82);
--composer-bg: rgba(249, 249, 249, 0.9);
--input-bg: #ffffff;
--input-border: #c9c9ce;
--icon: #8e8e93;
--placeholder: #a4a4a9;
--tint: #007aff;
--card: #f4f4f4;
--card-text: #555555;
--secondary-text: #666666;
--tertiary-text: #888888;
--guide-bg: #f0f7ff;
```

For the demo, prefer light mode unless there is a strong reason to show both.

### Shape Language

- Main phone/chat canvas max width: `480px`
- Onboarding modal max width: `420px`
- Large modal/card radius: `24px`
- Standard control radius: `12px`
- Smaller info chip/card radius: `10px` to `16px`
- Avatars are circular
- Buttons are simple rounded rectangles, not pill-heavy marketing buttons

### Shadows and Blur

Use soft, quiet shadows only:

- Modal shadow: `0 24px 70px rgba(0,0,0,.22)`
- Header blur: `backdrop-filter: saturate(180%) blur(20px)`

Avoid dramatic floating-card shadows.

## Demo Structure

Build this as a short interactive sequence or a single component with controlled states. The important thing is that the viewer clearly understands the flow.

Recommended state order:

1. Shared link preview
2. Opening/loading
3. Open room path
4. Passcode-required path
5. Return-on-this-device note

You can implement this as tabs, a stepper, a swipeable sequence, or one animated state machine. Keep it concise.

## State 1: Shared Link Preview

This is the most important setup state.

### What must be visible

- A link or share card showing a believable room URL such as `/ch/demo-room`
- Room identity:
  - room avatar
  - room name
  - accent color
- Clear statement that this is an anonymous chat room reached from a shared link

### Visual treatment

- Use a compact card, not a full marketing layout
- White or very pale background
- Blue accent around the link/share affordance
- One subtle lock cue may appear, but only as optional protection
- The room should already feel specific, not abstract

### Suggested copy

- Title: `Anonymous chat through a shared link`
- Supporting line: `Join without an account and find channels you visited here again.`
- Supporting bullets:
  - `Anonymous, no login required`
  - `Enter through a shared link`
  - `Share live moments`

These lines are close to production wording and should not be rewritten into marketing copy.

## State 2: Opening / Bootstrap

The moment after tapping the link should feel immediate.

### What must happen

- Transition from the link into the room, not to another generic page
- Keep room avatar, room name, and accent color visible during loading
- Show a lightweight chat skeleton so it feels like the room is opening

### Visual treatment

- Use the actual chat shell proportions
- Header appears first
- Message skeleton rows fill the conversation area
- Do not show a spinner-only screen

### Exact production shell cues

- Chat canvas centered with max width `480px`
- Header has blurred translucent background
- Header has:
  - back/dashboard icon on the left
  - room avatar centered
  - room name under avatar
  - share/search/menu icons on the right

Icons should be simple stroked iOS-style icons, not filled Material icons.

## State 3A: Open Room

This is the default happy path.

### What must be visible

- The room opens straight into chat
- A realistic header
- A few believable chat bubbles
- A composer at the bottom
- Optional reactions or subtle live indicators if useful

### Room shell details

- Background is white unless a room-specific color/image is shown
- Sent bubbles use `#3598fe`
- Received bubbles use `#e8e8ed`
- Meta text uses `#8e8e93`
- Primary text is near-black

### Header details

- Frosted light header
- Very thin bottom border
- Avatar centered above the room name
- Action icons tinted with the room accent color

### Message styling

- Rounded bubbles
- Moderate vertical spacing
- No oversized timestamps
- No desktop chat chrome
- Do not over-illustrate; it should look like a real chat transcript

### Composer styling

- Light translucent composer bar
- Rounded input
- Minimal plus/send affordances
- Not a giant CTA button row

## State 3B: Passcode-Required Room

This is the branch that proves access control without breaking the simple flow.

### Mandatory behavior

- Keep the same room identity visible
- Replace only the conversation access with a passcode prompt
- Do not make this look like account authentication

### Passcode screen details

- Full-screen room entry overlay on the same white app background
- Centered content column
- Max content width around `300px`
- Circular room avatar `80px`
- Room name under avatar
- Small line of explanatory text:
  - `This channel requires a passcode`
- Optional public hint card if a hint exists
- Centered passcode input
- Rounded submit button in the room accent color

### Error behavior

- Wrong passcode triggers:
  - inline error text
  - brief shake animation
  - input clears
  - focus returns to the field

### Suggested copy

- `This channel requires a passcode`
- `Hint: ...` when present
- Input placeholder: `Enter passcode`
- Button label: `Enter Channel`
- Error: `Wrong passcode`

Do not rewrite this into security-heavy copy.

## State 4: Return On This Device

The production product explains that anonymous return state is local to this browser/device.

This should appear as a supporting informational panel, not the main event.

### What it needs to say

- The channel can be reopened later on this device
- No login is required for that local return
- The remembered list does not automatically appear on another device/browser

### Good production-faithful wording

- `Return on This Device`
- `Without login, your channel list and personal colors are saved only on this device. They won't appear in another browser or on another device.`

### Visual treatment

- Small secondary card
- Light gray or pale blue background
- Quiet iconography

## Motion Guidance

Motion should be subtle and functional.

### Use

- Link card compresses or slides into room shell
- Skeleton resolves into chat content
- Passcode overlay swaps in without losing room context
- Wrong passcode uses a short horizontal shake

### Do not use

- Large springy hero animations
- 3D transforms
- Overly glossy transitions
- Marketing-style parallax

Recommended timing:

- Main transitions: `180ms` to `220ms`
- Ease: `cubic-bezier(.22,.61,.36,1)` or simple `ease`

## Copy Set To Use

Use these strings or very close equivalents:

- `Anonymous chat through a shared link`
- `Join without an account and find channels you visited here again.`
- `Anonymous, no login required`
- `Send messages and reactions without creating an account or profile.`
- `Enter through a shared link`
- `Only people with the channel link can find it, with an optional passcode for protection.`
- `Joining is simple`
- `Open the channel link`
- `Open the shared /ch/ address and enter its passcode if required.`
- `Chat anonymously`
- `Join without a nickname or login and choose your own color for each channel.`
- `Return on This Device`
- `Without login, your channel list and personal colors are saved only on this device. They won't appear in another browser or on another device.`

Do not turn this into brand copy like:

- `Private communities made effortless`
- `Instantly connect with your people`
- `Safe, magical conversations`

That would not match production tone.

## Layout Specification

Use this as the concrete implementation baseline.

### Outer Demo Frame

- Centered stage
- Mobile-first phone-sized surface
- Demo canvas width: `390px` to `430px`
- Production-faithful room shell max width: `480px`

### Shared Link Card

- Radius: `16px`
- Background: white or `#f4f4f4`
- Accent: `#007aff`
- Include actual room slug text
- Include one compact share icon

### Onboarding / Supporting Explanation Card

- Modal/card max width: `420px`
- Radius: `24px`
- Shadow: `0 24px 70px rgba(0,0,0,.22)`
- Header with tiny pagination dots if you show multiple slides
- Pale blue icon circles: background `#eaf3ff`, icon/text `#007aff`

### Chat Header

- Height roughly `60px` to `72px`
- Background: `rgba(249,249,249,.82)`
- Blur: `20px`
- Border bottom: `0.5px solid rgba(0,0,0,.12)`
- Centered avatar and room name
- Left navigation icon
- Right-side share/search/menu icons

### Passcode Screen

- Background: plain white app background
- Content max width: `300px`
- Avatar: `80px`
- Input radius: `12px`
- Button radius: `12px`
- Hint card radius: `10px`

## Interaction Rules

These are not optional.

- Opening the link must feel like a direct room open.
- Passcode is shown only if needed.
- Room identity never disappears during access control.
- Login UI must not appear anywhere in this component.
- Anonymous status should be obvious from copy, not from a complex settings explanation.
- The return-memory concept should be framed as convenience, not account sync.

## Recommended Demo Implementation Pattern

If you need one concrete pattern, use this:

1. Show a small share sheet or link card with `/ch/demo-room`.
2. On click, animate into a mobile chat shell.
3. First show a realistic loading state with header and bubble skeletons.
4. Let the viewer toggle between:
   - `Open room`
   - `Passcode room`
5. For `Open room`, reveal a short populated conversation.
6. For `Passcode room`, reveal the passcode overlay with optional hint and wrong-passcode behavior.
7. Add a final small note card for `Return on This Device`.

This is the clearest portfolio format because it demonstrates both the common case and the protected case without making the viewer guess.

## Quality Bar

The result should feel like a screenshot sequence from a real shipping app.

It fails if it feels like:

- a SaaS landing page
- a messenger redesign exercise
- an abstract feature diagram
- an onboarding wizard detached from the room

It succeeds if a viewer immediately understands:

- `someone sends me a room link`
- `I open it`
- `I enter anonymously`
- `if needed, I enter a passcode`
- `I am now in a real mobile chat room`

## Acceptance Checklist

- The first visible object is a shared room link.
- The room route visibly resembles `/ch/{slug}`.
- The UI looks mobile-first and iOS-native.
- The palette is white/gray/blue, not brand-heavy.
- The demo contains both open-room and passcode-room outcomes.
- The passcode state preserves room avatar, name, and accent.
- The room shell looks like a real chat surface.
- Copy clearly says login is not required.
- Copy clearly says remembered return is device-local.
- There is no sign-up, account, or browse-first detour.

## Production-Faithful Reference Notes

These notes are here only to justify the spec. The portfolio agent should not need to open the source files to build the demo.

- The route is a direct room page under `/ch/[slug]`.
- Guest onboarding copy is explicitly link-first and anonymous-first.
- The app issues anonymous identity automatically during bootstrap.
- Protected rooms return a passcode-gated bootstrap state rather than a login wall.
- The chat shell uses a narrow mobile canvas with a frosted header.
- The passcode overlay is a centered, minimal white screen with room avatar, room name, optional hint, and a single action button.
- Recent channels are stored locally in browser storage for same-device return.
