# yap.

**yap.** is a link-based, multi-tenant anonymous chat service built with Next.js and Cloudflare.

Production: [letmetellu.vercel.app](https://letmetellu.vercel.app)

## Current status

The project is a deployed MVP with:

- anonymous, link-only channel access with optional passcodes and hints;
- real-time chat over WebSockets;
- replies, reactions, editing, deletion, reporting, blocking and banned words;
- multiple-image messages, R2 media storage, gallery and link panels;
- private DMs visible only to the channel owner;
- temporary live sessions with configurable emoji presets and automatic session cleanup;
- channel notices, rules, welcome messages and chat freezing;
- Korean and English UI;
- an iMessage-style dashboard for owned and recently joined channels.

## Architecture

```text
Browser ── Next.js pages and authenticated API ──> Vercel
Browser ── HTTP API and WebSocket ───────────────> Cloudflare Worker
Cloudflare Worker ── relational data ───────────> D1
Cloudflare Worker ── media ─────────────────────> R2
Cloudflare Worker ── realtime room state ───────> Durable Objects
```

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 App Router, React 19, Tailwind CSS |
| Authentication | Auth.js / NextAuth v5, split Google OAuth login/signup, existing credential accounts |
| API | Cloudflare Workers |
| Database | Cloudflare D1 |
| Realtime | one `ChatRoom` Durable Object per channel |
| Media | Cloudflare R2 |
| Hosting | Vercel + Cloudflare |

Normal channel and live-session traffic share the parent channel's Durable Object. Live messages use a temporary `${channelId}_live` D1 channel and are deleted when the session ends.

## Dashboard behavior

- The dashboard is the main entry point for logged-in and guest users.
- Logged-in users can own up to **5 channels**. The Worker enforces this limit.
- Logged-in users' recent channels, pinned state and personal channel colors are stored in `user_recent_channels` and follow the account across devices.
- Logged-in users' font-size preference follows the account; guest preferences remain browser-local.
- Guest users' recent channel list and personal colors stay in that browser only.
- Recent joined channels have no application-level count limit.
- Name search covers only owned or previously joined channels.
- A new channel can be resolved by entering an exact `/ch/name`, domain path or full URL and pressing Enter. Pasting a complete address resolves it immediately.
- Owned and joined channels are labeled separately for logged-in owners.
- Owned channels are private on the owner's public channel profile by default. Owners can explicitly publish individual channels.
- Deleting an owned channel removes its messages, DMs, gallery entries, configuration, media and recent-list references.

## Authentication status

- Google OAuth login and signup use separate Auth.js providers. Google login requires an existing account; Google signup creates a new account or returns an account-exists error.
- The Credentials provider remains available for existing email/password accounts.
- New credential signup and password-reset email are enabled in Resend sandbox mode for the configured test recipient.
- New accounts remain pending until a single-use, 30-minute email link is confirmed.
- Password-reset links are single-use, expire after 30 minutes and do not reveal whether an address exists.
- Legacy SHA-256 password records are still recognized by the Worker; the current code attempts to upgrade a successful legacy login to salted PBKDF2.
- There is no platform-wide administrator role. Administration is scoped to channel ownership.

Before opening credential signup to the public, verify a sending domain and finish production monitoring for email delivery, rate limits and the legacy-hash upgrade path.

## Chat and moderation

### Messaging

- D1-backed messages with WebSocket payload broadcasts
- replies, reactions, edit/delete and long-message expansion
- multi-image upload with captions
- YouTube, X/Twitter, Instagram and Open Graph embeds
- cursor-based message, gallery and link pagination
- local-timezone date grouping in chat, gallery and link panels, localized for Korean and English
- direct message-context lookup for old gallery/link entries, with bidirectional 50-message pagination
- a dedicated context-reading mode that counts incoming realtime messages and offers a return-to-latest control
- full-text search using D1 FTS5
- loading and reconnect states without forced scroll jumps

### Channel controls

- optional passcode and passcode hint
- channel rules, notice banner and configurable welcome popup
- freeze/unfreeze
- banned words with expiry
- block/unblock by anonymous UID and device fingerprint
- optional petitions from blocked users
- optional private DM to the owner
- profile image, channel name and channel color
- optional owner-profile visibility, private by default

### Live sessions

- separate temporary message and DM storage
- owner-configured title and emoji presets
- live-only notice and freeze state
- viewer count through the channel Durable Object
- automatic deletion of live messages, DMs, gallery records and R2 media at session end

## Security model

- Vercel validates Auth.js sessions before forwarding owner actions.
- Vercel and the Worker share `INTERNAL_SECRET`; the Worker also verifies `X-User-Id` ownership.
- Anonymous users cannot mark messages as administrative.
- WebSocket owner authentication uses short-lived tokens from `/api/ws-token`.
- Passcode-protected endpoints require a signed room token tied to the current passcode hash.
- Anonymous mutations require a Worker-signed anonymous identity token; the Worker derives anonymous `uid` server-side instead of trusting the client body.
- New-message and DM length, DM toggles, upload type/size, freeze state, blocked users and banned words are enforced server-side.
- Message edits reuse the same validation boundary as message creation, including freeze, block, banned-word and rate-limit checks.
- Message-attached and DM-attached media are deleted from R2 with their source records; passcode-protected media now requires a current room token.
- Public chat and DM uploads now require a signed anonymous or owner identity, use durable per-channel upload quotas and must present a matching upload ticket before media can be attached.
- Failed credential logins are throttled independently by hashed email and IP identifiers.
- DMs are sent only to owner-authenticated WebSocket connections.
- SQL uses bound parameters.
- CORS is restricted to the production origin and local development.

### Recent security fixes

- Message edits now reuse server-side create-message validation instead of trusting the previous relaxed edit path.
- Attached message and DM media is removed from R2 when the source content is deleted, and passcode-protected media now checks room access on read.
- Media reads now resolve source metadata through ordered batched D1 lookups instead of a compound `UNION` query, avoiding `D1_ERROR: too many terms in compound SELECT` on `/api/media/*` without relaxing room-token or upload-ticket checks.
- DM creation now enforces the channel DM toggle, petition-only behavior for blocked users, rate limits, message length and banned-word checks in the Worker.
- Anonymous message, reaction, report and DM mutations now derive identity from a Worker-signed token instead of a raw client-provided `uid`.
- Public-channel uploads now use durable upload tickets, per-channel quotas and pending-object cleanup instead of allowing unattached anonymous R2 writes.

### Open security findings — 2026-07-26

> **Release warning:** The items below were confirmed by code review and are
> not fixed yet. Server-side report hardening should be completed before a
> public launch.

| Priority | Finding | Current risk | Required direction |
| --- | --- | --- | --- |
| High | Link preview fetch accepts an arbitrary URL | The Worker can be abused for SSRF-like requests, redirects and large downloads | Allow only HTTP(S), reject private/local destinations before and after redirects, and add timeout, response-size and rate limits |
| Medium | Reports rely on browser-local deduplication | A caller can submit duplicate or fabricated report messages directly | Validate the target, enforce one active report per signed reporter/target and add durable throttling |
| Medium | Message rate limiting is isolate-local and keyed by mutable UID | Limits reset across isolates/restarts and can be bypassed by changing UID | Move enforcement to a channel Durable Object, D1 or Cloudflare Rate Limiting and key it with signed identity plus IP HMAC |
| Medium | No explicit application security-header policy | XSS and content-sniffing defenses depend on framework/platform defaults | Add CSP, `nosniff`, Referrer Policy, Permissions Policy, frame restrictions and HSTS with widget domains tested |

`npm audit --omit=dev` reported three high and one moderate production
dependency findings. The affected chain is Next.js `16.2.11` through bundled
PostCSS `8.4.31` and Sharp `0.34.5`, with NextAuth reported transitively.
Do **not** run `npm audit fix --force`: its proposed Next.js `9.3.3` downgrade
is incompatible with this application. Upgrade Next.js normally, test the
current fixed PostCSS/Sharp versions when compatible, and rerun the production
build and audit.

Recommended remediation order:

1. server-side report policy;
2. preview-fetch SSRF controls;
3. durable rate limits;
4. dependency upgrades and response security headers.

### 미해결 보안 점검 결과 — 2026-07-26

아래 항목은 코드 검토로 확인했으며 아직 수정되지 않았습니다. 공개 출시
전에는 신고 정책 강화가 먼저 필요합니다.

- **높음:** 링크 미리보기 Worker가 임의 URL을 가져오므로 프로토콜·사설
  주소·리디렉션·응답 크기·timeout·rate limit 검사가 필요합니다.
- **중간:** 신고 중복 제한은 브라우저 저장값에 의존하고, 메시지 rate
  limit은 Worker 인스턴스 메모리와 변경 가능한 UID에 의존합니다.
- **중간:** CSP, `nosniff`, Referrer Policy, Permissions Policy, 프레임
  제한과 HSTS를 명시적으로 설정하지 않았습니다.

수정 순서는 신고 정책 → 미리보기 SSRF 방어 →
지속형 rate limit → 의존성·보안 헤더
순서를 권장합니다. 강제 `npm audit fix`는 Next.js 9로 잘못
다운그레이드하므로 사용하지 않습니다.

## Platform moderation roadmap

> **Status:** This section describes a planned platform-wide moderation system.
> It is not implemented yet. Channel-owner administration remains the only
> administrative role in the current production application.

Platform moderation must remain separate from channel ownership. A channel
owner may manage only channels they own, while a platform operator may review
reports and apply explicitly authorized service-level actions. Platform access
must never be implemented as a client-provided `is_admin` flag or as a blanket
bypass in the existing channel-admin API.

### Proposed roles

| Role | Scope |
| --- | --- |
| `reviewer` | View reports and evidence, add internal review notes |
| `moderator` | Resolve reports, warn owners, restrict, suspend and restore channels |
| `super_admin` | Grant and revoke operator roles, perform destructive or system-level actions |

The first deployment may use one `super_admin`, but the permission checks
should still be role-based so review access can later be delegated without
granting suspension, deletion or role-management privileges.

### Authorization boundary

```text
Operator browser
  └─ Auth.js session
      └─ Vercel /api/platform-admin/*
          └─ INTERNAL_SECRET + authenticated user ID
              └─ Cloudflare Worker
                  └─ D1 platform_admins role check on every request
```

- Hiding the operator UI is not authorization.
- The browser must never choose or submit its own trusted role.
- Vercel authenticates the session, but the Worker makes the final role and
  permission decision.
- The Worker checks `platform_admins` on every sensitive request so role
  revocation takes effect immediately.
- Platform endpoints live under a dedicated `/api/platform-admin` namespace;
  they do not reuse `/api/admin`, which is scoped to channel ownership.
- Authorization defaults to deny when no explicit permission matches.

### Proposed data model

`platform_admins` stores operator assignments:

```sql
CREATE TABLE platform_admins (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (
    role IN ('reviewer', 'moderator', 'super_admin')
  ),
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
```

`channel_reports` stores platform-level reports. Reporter network and device
signals are HMAC-hashed; raw IP addresses and fingerprints are not retained.

```sql
CREATE TABLE channel_reports (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  reporter_user_id TEXT,
  reporter_session_hash TEXT,
  fingerprint_hash TEXT,
  ip_hash TEXT,
  reason TEXT NOT NULL,
  description TEXT,
  evidence_message_ids TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);
```

`platform_audit_logs` is an append-only record of privileged activity:

```sql
CREATE TABLE platform_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
```

Application routes must not update or delete audit records. Every report
resolution, warning, restriction, suspension, restoration, permanent deletion,
operator assignment and operator revocation records the actor, target, reason,
previous state and resulting state.

### Report submission policy

- A reporter may have one active report per channel.
- A resolved report may be submitted again after a seven-day cooldown when a
  new violation occurs.
- A reporter may report at most three different channels per day.
- Anonymous deduplication uses a signed anonymous session plus hashed
  fingerprint and IP signals; browser-local UID alone is not trusted.
- The reporter selects a structured reason and may add up to 500 characters of
  context and up to three evidence message IDs.
- Duplicate submissions update the existing active report rather than creating
  an unlimited number of records.
- Report volume changes review priority only. It must never automatically
  delete a channel.
- Child-safety or immediate-danger categories bypass normal queue priority and
  are flagged for urgent review.

Suggested report categories are illegal or dangerous content, harassment or
hate, sexual content, privacy exposure, impersonation or fraud, spam and other.

### Moderation states and actions

Enforcement should be reversible by default:

```text
active → restricted → suspended → removed
```

- `active`: normal service.
- `restricted`: new messages or uploads are limited while evidence is reviewed.
- `suspended`: visitors see a suspension dialog; channel data remains intact.
- `removed`: public access is disabled after a confirmed violation.
- Permanent deletion is a separate `super_admin` action requiring explicit
  confirmation, a reason and recent re-authentication.

The initial operator console should support:

- report queue filtering by status, category, priority and assignee;
- report details with selected evidence, current channel state, recent relevant
  messages, previous reports and previous actions;
- no-violation resolution, internal notes, owner warning, restriction,
  suspension and restoration;
- mandatory reason entry for every enforcement action;
- an audit-history view.

Reporter identity, account ID, UID, fingerprint and IP signals are never shown
to the reported channel owner. Owners receive the violated policy category,
affected content and allowed appeal path, but not the reporter's identity.

### Operator account security

- Bootstrap the first `super_admin` by inserting the exact ID of an existing,
  verified account through Wrangler/D1 tooling; there is no public operator
  signup flow.
- Require Google/OIDC authentication for operators rather than credential
  passwords.
- Use shorter operator sessions and re-authentication for permanent deletion,
  data export and role changes.
- Protect a future custom admin domain with Cloudflare Access and MFA.
- Validate request origin, session, internal proxy token and D1 role on every
  operator API request.
- Rate-limit report reads, exports and enforcement actions.
- Revoke active operator sessions when a role is removed.
- Never expose raw secrets, IP addresses, fingerprints or authentication tokens
  in audit logs.

### Recommended delivery phases

1. Define report categories, enforcement states, retention and appeal policy.
2. Add `platform_admins`, `channel_reports`, `platform_audit_logs` and channel
   moderation-state migrations.
3. Implement shared `requirePlatformRole()` and append-only audit helpers.
4. Add non-owner channel reporting with deduplication and rate limits.
5. Build `/platform/reports` queue and report-detail views.
6. Add reversible restriction, suspension and restoration actions.
7. Add owner notifications and one appeal per enforcement decision.
8. Add MFA, recent re-authentication, monitoring, export controls and role
   administration.

The recommended MVP is one manually bootstrapped `super_admin`, channel-report
submission, a private report queue, no-violation/suspend/restore actions,
mandatory reasons and audit logs. Automatic deletion, multiple operator roles,
appeals and permanent deletion should follow only after the core review flow is
stable.

## 플랫폼 운영 및 신고 시스템 로드맵

> **현재 상태:** 이 절은 앞으로 구현할 플랫폼 전체 운영 시스템의
> 설계안입니다. 아직 프로덕션에 구현되지 않았으며, 현재 서비스에는 자신이
> 소유한 채널만 관리하는 채널 관리자 권한만 존재합니다.

플랫폼 운영자 권한은 채널 소유권과 완전히 분리합니다. 채널 관리자는 자신이
소유한 채널만 관리하고, 플랫폼 운영자는 신고를 검토한 뒤 허용된 서비스
차원의 조치만 실행합니다. 클라이언트가 보내는 `is_admin` 값이나 기존 채널
관리 API의 무조건적인 우회 플래그로 구현하면 안 됩니다.

### 제안 역할

| 역할 | 권한 범위 |
| --- | --- |
| `reviewer` | 신고와 증거 열람, 내부 검토 메모 작성 |
| `moderator` | 신고 처리, 채널 경고·제한·정지·복구 |
| `super_admin` | 운영자 지정·해제, 영구 삭제와 시스템 수준 작업 |

초기에는 한 계정만 `super_admin`으로 사용할 수 있지만, 코드에서는 처음부터
역할별 권한을 분리합니다. 그래야 나중에 신고 검토만 맡길 사람에게 정지,
삭제, 운영자 관리 권한까지 주는 일을 피할 수 있습니다.

### 권한 확인 경계

```text
운영자 브라우저
  └─ Auth.js 세션
      └─ Vercel /api/platform-admin/*
          └─ INTERNAL_SECRET + 인증된 사용자 ID
              └─ Cloudflare Worker
                  └─ 매 요청마다 D1 platform_admins 역할 확인
```

- 운영 화면을 숨기는 것은 권한 검사가 아닙니다.
- 브라우저가 역할을 선택하거나 신뢰 가능한 역할 값을 보내게 하지 않습니다.
- Vercel은 로그인 세션을 인증하고, 최종 권한 판단은 Worker가 수행합니다.
- Worker는 민감한 요청마다 `platform_admins`를 조회하므로 권한을 해제하면
  즉시 적용됩니다.
- 플랫폼 API는 `/api/platform-admin`으로 분리하고, 채널 소유자 전용
  `/api/admin`과 섞지 않습니다.
- 명시적으로 허용된 권한이 없으면 기본적으로 거부합니다.

### 제안 데이터 구조

- `platform_admins`: 운영자 계정, 역할, 활성 상태와 지정·해제 기록
- `channel_reports`: 신고 사유, 설명, 증거 메시지, 처리 상태와 담당자
- `platform_audit_logs`: 모든 운영자 조회·처리·권한 변경의 추가 전용 기록

신고자의 IP와 fingerprint 원문은 저장하지 않고 `INTERNAL_SECRET` 기반 HMAC
해시만 저장합니다. 감사 로그는 애플리케이션 API에서 수정하거나 삭제할 수
없어야 합니다. 신고 처리, 경고, 제한, 정지, 복구, 영구 삭제, 운영자
지정·해제에는 작업자, 대상, 사유, 변경 전 상태와 변경 후 상태를 기록합니다.

### 채널 신고 규칙

- 사용자 한 명은 같은 채널에 활성 신고 1건만 유지할 수 있습니다.
- 신고 처리 완료 후 새로운 위반이 있으면 7일 뒤 다시 신고할 수 있습니다.
- 사용자 한 명이 신고할 수 있는 채널은 하루 최대 3개입니다.
- 익명 사용자는 서명된 익명 세션, fingerprint 해시와 IP 해시를 조합해
  중복을 판단하며 브라우저 UID만 신뢰하지 않습니다.
- 신고 사유는 필수 선택이고, 추가 설명은 최대 500자, 증거 메시지는 최대
  3개까지 첨부할 수 있습니다.
- 중복 신고는 새 레코드를 계속 만들지 않고 기존 활성 신고에 증거와
  갱신 시각을 추가합니다.
- 신고 수는 검토 우선순위만 높이며 채널을 자동 삭제하지 않습니다.
- 아동 안전이나 즉각적인 위험 신고는 건수와 관계없이 긴급 검토 대상으로
  표시합니다.

권장 신고 분류는 불법·위험 콘텐츠, 괴롭힘·혐오, 성적 콘텐츠, 개인정보
노출, 사칭·사기, 스팸, 기타입니다.

### 채널 상태와 운영 조치

운영 조치는 기본적으로 복구 가능해야 합니다.

```text
active → restricted → suspended → removed
```

- `active`: 정상 상태
- `restricted`: 검토 중 새 메시지나 업로드 일부 제한
- `suspended`: 방문자에게 정지 안내를 표시하고 데이터는 유지
- `removed`: 위반 확정 후 공개 접근 차단
- 영구 삭제: `super_admin`만 최근 재인증, 명시적 확인과 사유 입력 후 실행

초기 운영자 화면에는 신고 상태·분류·우선순위·담당자 필터, 증거 메시지,
현재 채널 상태, 관련 최근 메시지, 과거 신고와 조치 이력, 문제없음 처리,
내부 메모, 경고, 제한, 정지, 복구, 감사 로그가 필요합니다. 모든 조치에는
사유 입력을 필수로 받습니다.

신고자의 계정, UID, fingerprint와 IP 신호는 신고 대상 채널 관리자에게
공개하지 않습니다. 채널 관리자에게는 위반 분류, 대상 콘텐츠와 이의 제기
방법만 안내합니다.

### 운영자 계정 보안

- 공개 운영자 가입 기능을 만들지 않습니다.
- 기존 인증 완료 계정의 정확한 사용자 ID를 Wrangler/D1 도구로 직접
  등록해 최초 `super_admin`을 만듭니다.
- 운영자는 이메일 비밀번호보다 Google/OIDC 인증만 허용합니다.
- 운영자 세션은 일반 세션보다 짧게 유지합니다.
- 영구 삭제, 데이터 내보내기, 역할 변경에는 최근 재인증을 요구합니다.
- 커스텀 관리자 도메인을 연결한 뒤 Cloudflare Access와 MFA를 적용합니다.
- 모든 운영 API 요청에서 Origin, 세션, 내부 프록시 토큰과 D1 역할을
  확인합니다.
- 신고 조회, 내보내기와 운영 조치에 rate limit을 적용합니다.
- 운영자 권한을 해제하면 활성 운영자 세션도 무효화합니다.
- 감사 로그에 비밀키, 원본 IP, fingerprint와 인증 토큰을 기록하지 않습니다.

### 권장 구현 순서

1. 신고 분류, 운영 조치, 데이터 보존 기간과 이의 제기 정책을 확정합니다.
2. 운영자, 신고, 감사 로그와 채널 운영 상태 D1 마이그레이션을 추가합니다.
3. 공통 `requirePlatformRole()`과 추가 전용 감사 로그 함수를 구현합니다.
4. 비관리자 채널 신고, 중복 방지와 rate limit을 구현합니다.
5. `/platform/reports` 신고 목록과 상세 화면을 구현합니다.
6. 복구 가능한 제한, 정지와 복구 조치를 구현합니다.
7. 채널 관리자 통보와 운영 조치별 이의 제기 1회를 구현합니다.
8. MFA, 최근 재인증, 모니터링, 내보내기 통제와 운영자 관리를 추가합니다.

권장 MVP는 직접 등록한 `super_admin` 한 명, 채널 신고 접수, 비공개 신고
대기열, 문제없음·정지·복구 처리, 필수 처리 사유와 감사 로그입니다. 자동
삭제, 여러 운영자 역할, 이의 제기와 영구 삭제는 핵심 검토 흐름이 안정된
뒤 추가합니다.

## Local development

Requirements:

- Node.js 22 recommended
- npm
- Cloudflare Wrangler authentication for Worker and D1 work

```bash
npm install
npm run dev
```

Production-style frontend verification:

```bash
npm run build
npm start
```

Worker development:

```bash
cd worker
npm install
npm run dev
```

Set `NEXT_PUBLIC_MOCK=true` to use the frontend mock implementation instead of the Worker where supported.

## Environment variables

Create `.env.local` for Next.js:

```dotenv
AUTH_SECRET=<openssl-rand-base64-32>
AUTH_URL=http://localhost:3000

GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>

NEXT_PUBLIC_WORKER_URL=https://letsplay-api.letmetellu.workers.dev
NEXT_PUBLIC_MOCK=false

INTERNAL_SECRET=<same-value-as-worker-secret>
APP_VERSION=<optional-local-version-label>
```

Set `AUTH_URL` to the deployed frontend origin in production, for example `https://letmetellu.vercel.app`.

Configure the same frontend variables in Vercel. `VERCEL_GIT_COMMIT_SHA` is supplied by Vercel and is used as the deployed version identifier.

The Google OAuth client must authorize both current callback URIs:

- `https://<your-domain>/api/auth/callback/google-login`
- `https://<your-domain>/api/auth/callback/google-signup`

Keep the legacy `https://<your-domain>/api/auth/callback/google` redirect URI only while older deployments still depend on it.

Configure the Worker secret:

```bash
cd worker
npx wrangler secret put INTERNAL_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_TEST_RECIPIENT
npx wrangler secret put APP_ORIGIN
```

Never commit `.env.local`, Worker secrets, OAuth client secrets or production database exports.

## Database migrations

D1 migrations live in `worker/migrations`.

```bash
cd worker

# Local D1
npm run db:migrate

# Production D1
npm run db:migrate:prod
```

Apply a required migration **before** deploying Worker code that queries the new table or column.

Current migrations:

| Migration | Purpose |
| --- | --- |
| `0001_initial_schema.sql` | channels, messages, DMs, gallery, config, moderation, FTS5 |
| `0002_banned_words.sql` | per-channel banned words and expiry |
| `0003_users.sql` | user accounts |
| `0004_user_password.sql` | credential password hash column |
| `0005_hot_path_indexes.sql` | message, block and DM indexes |
| `0006_passcode_hint.sql` | optional channel passcode hint |
| `0007_user_recent_channels.sql` | account-synced recents, pins and personal colors |
| `0008_email_verification.sql` | verified-email state, single-use verification tokens and signup rate-limit records |
| `0009_channel_instance_id.sql` | unique channel incarnation ID for clearing stale browser state after address reuse |
| `0010_user_font_size.sql` | account-synced font-size preference |
| `0011_channel_profile_visibility.sql` | per-channel owner-profile visibility flag |
| `0012_default_channels_private.sql` | makes existing normal channels private on owner profiles |
| `0013_password_reset_tokens.sql` | single-use expiring credential password-reset tokens |
| `0014_channel_background.sql` | channel chat background mode, color, image, overlay and optional blur |
| `0015_deleted_accounts.sql` | legacy deleted-account tombstone table retained for already migrated environments |
| `0016_upload_tickets.sql` | durable upload tickets, quotas and pending-media cleanup for chat and DM media |

See [MIGRATION_NOTES.md](./MIGRATION_NOTES.md) for schema details and the deployment runbook.

## Deployment

Frontend deployment is triggered by pushing `main` to GitHub:

```bash
git push origin main
```

Worker deployment:

```bash
cd worker
npm run deploy
```

For changes involving D1, use this order:

1. `npm run db:migrate:prod`
2. `npm run deploy`
3. run `npm run build` at the repository root
4. push the frontend commit

Worker-only fixes that do not change the Next.js app or D1 schema, such as the
2026-07-29 `/api/media/*` D1 lookup fix, do not require a frontend deploy.

## Project structure

```text
src/
├── app/
│   ├── dashboard/             main dashboard
│   ├── ch/[slug]/             chat route
│   └── api/                   authenticated Next.js proxies
├── components/
│   ├── chat/                  chat, panels, dialogs and live UI
│   ├── admin/                 channel administration
│   └── dashboard/             login and onboarding dialogs
├── hooks/                     auth, locale, realtime and version hooks
└── lib/                       API clients, auth, locale and recent-channel storage

worker/
├── migrations/                ordered D1 migrations
├── src/
│   ├── realtime/chat-room.ts  Durable Object
│   ├── routes/                Worker API handlers
│   └── lib/                   validation and shared server helpers
└── wrangler.toml              D1, R2 and Durable Object bindings
```

## Known follow-up work

- verified Resend sending domain and production email-delivery monitoring;
- validate and harden the legacy credential upgrade path;
- typing indicators;
- additional social login providers;
- operational metrics, abuse controls and retention policies.
