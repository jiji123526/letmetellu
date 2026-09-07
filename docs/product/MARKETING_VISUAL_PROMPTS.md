# yap. 홍보 이미지·영상 제작 가이드와 프롬프트

이 문서는 yap. 베타 홍보용 정적 이미지, 숏폼 영상, 랜딩 페이지 히어로 비주얼을 일관된 스타일로 제작하기 위한 기준이다. 생성형 이미지·영상 모델에 그대로 붙여 넣을 수 있는 프롬프트와 실제 앱 화면 합성 지침을 함께 제공한다.

## 1. 한 문장 정의

> **공유받은 링크로 바로 들어와 익명으로 이야기하는, 방장이 직접 분위기를 관리할 수 있는 채팅 서비스.**

짧은 카피 후보:

- 링크 하나로 시작하는 익명 채팅, **yap.**
- 말하고 싶을 때, 링크만 공유해.
- 로그인 없이 들어오고, 필요한 만큼만 남겨요.
- 우리끼리 가볍게, 방장은 확실하게.
- Share the link. Start talking. **yap.**

## 2. 홍보물에 꼭 들어가야 하는 것

한 장에 모든 기능을 넣지 않는다. 각 홍보물은 아래에서 **핵심 메시지 1개와 보조 기능 2~3개**만 선택한다.

### 반드시 보여줄 핵심

1. **yap. 로고타입**
   - 반드시 소문자 `yap.`으로 표기하고 마지막 점을 포함한다.
   - 로고처럼 보이게 굵고 단순하게 사용한다.
2. **링크 기반 입장**
   - `/ch/channel-name` 형태의 짧은 주소가 공유되고 채팅 화면으로 연결되는 흐름.
   - 검색으로 공개 채널을 탐색하는 서비스처럼 표현하지 않는다.
3. **익명 참여**
   - 방문자는 로그인이나 프로필 생성 없이 바로 대화할 수 있다는 점.
   - 다만 방장은 채널 생성과 관리를 위해 로그인한다.
4. **실제 제품 UI**
   - 대시보드의 채널 목록 또는 실제 채팅 화면을 최소 한 번 보여준다.
   - 생성형 모델이 UI 글자를 직접 만들게 하지 말고 실제 스크린샷을 합성한다.
5. **베타 표기와 주소**
   - 현재 베타 홍보물에는 작은 `BETA` 라벨을 넣는다.
   - CTA에는 `yapndot.com`을 정확히 표기한다.

### 차별점으로 선택할 기능

- 링크를 가진 사람만 찾아오는 채널과 선택형 비밀번호·힌트
- 방장에게만 보이고 발신자 화면에도 남지 않는 비밀 메시지(DM)
- 일반 채팅과 분리되며 종료 시 세션 메시지가 삭제되는 라이브
- 채팅방 얼리기, 공지, 규칙, 금지어, 신고와 사용자 차단
- 여러 장의 이미지, 링크 위젯, 갤러리와 링크 패널
- 채널별 말풍선 색상과 배경 이미지·단색 꾸미기
- 최근 방문 채널을 메시지 목록처럼 다시 여는 대시보드

### 정확하게 표현해야 하는 제한

- “완전한 보안”, “절대 추적 불가”, “모든 기록이 즉시 삭제” 같은 표현은 사용하지 않는다.
- 삭제되는 것은 **종료된 라이브 세션의 메시지**이며 일반 채팅 전체가 아니다.
- DM은 방장에게만 표시되고 발신자의 채팅 화면에 남지 않지만, 안전·운영을 위한 서버 처리까지 없다고 표현하지 않는다.
- 비밀번호 채널도 링크 자체의 안전한 공유가 필요하다.
- 현재 베타는 안정적인 운영을 위해 채널 생성이 제한될 수 있다.

## 3. yap.에 맞는 비주얼 시스템

### 전체 인상

- 친숙한 모바일 메신저의 정돈된 리듬
- 가볍고 솔직하지만 유치하지 않은 분위기
- 흰색 여백, 둥근 카드, 얇은 디바이더, 부드러운 블러
- 작은 인터랙션이 살아 있는 차분한 프리미엄 제품 영상
- 사람 얼굴보다 **대화의 흐름, 공유 링크, 말풍선과 손동작**을 중심으로 표현

### 컬러

- 라이트 배경: `#FFFFFF`
- 기본 블루: `#007AFF`
- 채팅 블루: `#3B8DF0`
- 연한 회색 카드: `#F4F4F4`
- 보조 회색: `#8E8E93`
- 다크 배경: `#000000`
- 다크 카드: `#1C1C1E`
- 다크 블루: `#0A84FF`

채널별 색상 기능을 보여줄 때만 코랄, 라일락, 민트 등 한 가지 보조색을 추가한다. 한 화면에 강한 색은 블루를 포함해 최대 두 가지로 제한한다.

### 형태와 레이아웃

- 모바일 화면 비율은 약 9:19.5, 모서리는 크고 부드럽게 처리한다.
- UI 카드와 말풍선은 16~24px 수준의 둥근 모서리 감각을 유지한다.
- 한 프레임의 주인공은 항상 하나: 링크, 채팅 말풍선, 라이브 배너, 얼리기 상태 중 하나.
- 제품 화면 주변에는 최소 12% 이상의 여백을 남긴다.
- 텍스트는 화면 가장자리에서 충분히 떨어뜨리고 세이프 영역 안에 둔다.
- 그림자는 진한 검은 그림자보다 `rgba(0,0,0,0.10~0.18)` 수준의 넓고 부드러운 그림자를 사용한다.

### 모션

- 스프링은 짧고 절제되게: 과한 바운스 금지.
- 화면 전환 250~400ms, 기능 강조 500~900ms.
- 말풍선은 아래에서 8~16px 정도 올라오며 페이드인한다.
- 링크가 채널로 변환되는 장면은 링크 카드 → 채팅 화면의 매치 컷을 사용한다.
- 라이브는 작은 파동이나 점등으로 표현하되 방송 앱처럼 과장된 네온 효과는 피한다.
- 얼리기는 화면 전체를 얼음으로 덮지 말고 입력창이 조용히 잠기고 작은 눈송이 선 아이콘이 나타나는 식으로 표현한다.

### 아이콘

- 1.7~2px 스트로크의 단순한 라인 아이콘
- 둥근 선 끝과 모서리
- 이모지는 실제 채팅 리액션을 제외하면 주요 기능 아이콘으로 사용하지 않는다.
- Apple 로고, Messages 로고, Dynamic Island 등 특정 제품을 그대로 복제하지 않는다.

## 4. 제작 원칙: 생성형 비주얼과 실제 UI 합성

생성형 모델은 분위기, 조명, 손, 공간, 기기 목업과 모션을 만드는 데 사용한다. 다음 요소는 후반 작업에서 실제 자산으로 합성한다.

- `yap.` 서비스명
- `yapndot.com`
- 한국어·영어 카피
- 채팅 메시지와 버튼 글자
- 실제 대시보드·채팅 스크린샷
- 자물쇠, 라이브, 공유 등 제품 아이콘

권장 순서:

1. 개인정보가 없는 데모 채널과 데모 메시지를 준비한다.
2. 라이트·다크 모드 실제 화면을 동일한 크기로 캡처한다.
3. AI에는 텍스트 없는 배경, 손, 기기 프레임과 카메라 움직임만 생성시킨다.
4. Figma, After Effects, CapCut 등에서 실제 화면을 기기 면에 합성한다.
5. 모든 링크, 이름, 메시지가 실제 사용자 정보가 아닌지 확인한다.

## 5. 정적 홍보 이미지 마스터 프롬프트

### A. 베타 출시 대표 이미지 — 4:5

```text
Create a polished social launch poster for a mobile-first anonymous chat service named "yap.". Vertical 4:5 composition, generous white negative space, modern friendly messenger aesthetic, clean Korean digital product campaign, premium but approachable. Place one tall mobile app screen mockup slightly below center, showing a real chat interface placeholder area that will be replaced with an actual product screenshot in post-production. Around it, use only three subtle visual cues: a short shared-link card, a small lock outline icon, and a restrained live pulse indicator. Primary colors are white, #007AFF and #3B8DF0 with light gray #F4F4F4. Rounded cards, thin dividers, soft wide shadows, crisp 2D line icons, no glossy 3D objects, no gradients that overpower the UI.

Reserve a clear headline area at the top and a compact CTA area at the bottom. Do not generate readable UI text; leave clean placeholder regions for typography and screenshot compositing. The campaign should communicate: enter through a shared link, chat anonymously without login, and let the channel owner control the space. Add a very small neutral BETA badge area. Refined editorial lighting, pixel-perfect spacing, realistic product-design presentation, high resolution.

Negative prompt: Apple logo, iMessage logo, copied iPhone advertising, fake unreadable text, random letters, cyberpunk neon, hacker imagery, masks, surveillance imagery, padlocks everywhere, crypto aesthetic, childish emojis, excessive glassmorphism, clutter, stock-photo corporate people, dark threatening mood.
```

후반 카피 권장:

- 제목: `링크 하나로 시작하는 익명 채팅`
- 보조: `로그인 없이 들어오고, 방장은 필요한 만큼 관리해요.`
- CTA: `BETA · yapndot.com`

### B. 기능 카드형 이미지 — 1:1

```text
Design a square 1:1 feature campaign image for "yap.", a link-based anonymous chat service. Use a white or very pale gray background and a structured three-card layout with generous spacing. Each rounded card contains one simple line-icon placeholder and one product screenshot crop placeholder. The three concepts are: shared link with optional passcode, a private message visible only to the channel owner, and a temporary live session whose session messages disappear when the live ends. Use #007AFF as the primary accent, #3B8DF0 for message bubbles, neutral gray metadata, and one subtle lavender accent only for the private-message card. Calm, trustworthy, mobile-native, clean Korean product design. Cards should feel like part of the same real application, not separate illustrations.

Leave all copy areas blank for accurate Korean typography in post-production. Do not invent UI labels or messages. Crisp vector-like geometry, rounded line caps, soft shadows, no 3D emoji, no people, no Apple branding, no security claims, no futuristic hacker aesthetic.
```

후반 카드 제목:

1. `링크 받은 사람만`
2. `방장에게만 보이는 DM`
3. `끝나면 사라지는 라이브`

### C. 다크모드 감성 이미지 — 9:16

```text
Create a vertical 9:16 dark-mode product visual for "yap.", a mobile anonymous chat service. Matte black background #000000, dark cards #1C1C1E, precise blue accents #0A84FF, restrained soft bloom, and a centered floating mobile chat screen placeholder. Show the feeling of a quiet late-night group conversation through abstract message bubble shapes and subtle reaction dots, without showing faces or generating readable text. Include a small shared-link card transitioning toward the phone, suggesting that a private conversation begins from a link. Minimal cinematic lighting, elegant negative space, high contrast that still preserves readable UI zones, sophisticated Korean tech campaign, smooth rounded geometry.

Leave the upper third clean for a short headline and the lower safe area clear for yapndot.com. No neon cyberpunk, no glowing hacker code, no Apple logos, no fake UI text, no heavy glass effects, no clutter.
```

후반 카피 권장: `우리끼리 가볍게. yap.`

## 6. 15초 숏폼 영상 프롬프트와 구성

### 목적

처음 보는 사람이 15초 안에 “링크를 공유하면 로그인 없이 익명 채팅에 들어가는 서비스”라는 점을 이해하게 한다.

### 타임라인

| 시간 | 화면 | 카피/의도 |
|---|---|---|
| 0.0~2.0초 | 흰 배경에 `/ch/afterparty` 링크 카드 등장 | `링크 하나 보내면` |
| 2.0~4.5초 | 링크 카드가 실제 채팅 화면으로 매치 컷 | `로그인 없이 바로 입장` |
| 4.5~7.0초 | 익명 말풍선과 리액션이 부드럽게 등장 | 익명 채팅과 반응 |
| 7.0~9.5초 | 자물쇠·힌트 또는 방장 전용 DM을 짧게 강조 | 필요한 만큼 보호 |
| 9.5~12.5초 | 라이브 배너가 켜지고 종료 시 세션 말풍선이 정리됨 | `함께 보고, 끝나면 사라지는 라이브` |
| 12.5~15.0초 | `yap.` 로고와 주소, 작은 BETA 라벨 | `yapndot.com` |

### 영상 생성 마스터 프롬프트

```text
Create a 15-second vertical 9:16 launch film for a mobile-first anonymous chat service called "yap.". The motion language is clean, calm and native to a premium modern messenger: white background, #007AFF accent, #3B8DF0 chat bubbles, light gray cards, soft shadows, rounded geometry and precise spacing.

Shot 1: a minimal shared channel link card floats into the center with a gentle 300ms ease-out.
Shot 2: use a seamless match cut as the link expands into a tall mobile chat interface placeholder; the real app screen will be composited later, so keep the screen surface clean and stable.
Shot 3: two or three abstract chat bubbles slide upward by 12 pixels and fade in, followed by small restrained reaction badges.
Shot 4: show a single lock outline and then a private-message indicator moving only toward a small owner badge, communicating owner-only visibility without surveillance imagery.
Shot 5: a subtle LIVE pill activates with one soft pulse; several temporary session bubbles appear, then gently dissolve together when the live session ends. Do not imply that all normal chat history disappears.
Final shot: clean white end card with reserved typography areas for the exact logo "yap.", a small BETA label, and "yapndot.com".

Use controlled transitions, 250–400ms interface motion, no large bounce, no camera shake, no fast zoom, no fake readable text. Keep the phone and UI front-facing so real screenshots can be corner-pinned accurately. High-end Korean mobile product advertising, friendly rather than corporate, minimal sound-design cues implied: soft tap, message pop, quiet live pulse.

Negative prompt: Apple logo, iMessage branding, fake gibberish UI text, cyberpunk, hackers, anonymity masks, security shield clichés, neon gradients, excessive glow, emoji icons as feature symbols, stock people, childish motion, exaggerated elastic bounce, deleting all chat history.
```

### 내레이션/자막 초안

```text
링크 하나 보내면,
로그인 없이 바로 시작.
우리끼리 익명으로 이야기하고,
방장은 필요한 만큼 관리해요.
yap. — 링크로 시작하는 익명 채팅.
```

## 7. 30초 기능 소개 영상 프롬프트와 구성

### 타임라인

1. **0~4초 — 문제 제시**
   - “가입시키기엔 무겁고, 공개 채팅은 부담스러울 때.”
2. **4~8초 — 링크 공유와 입장**
   - 방장이 채널 링크를 복사하고 상대가 바로 입장.
3. **8~13초 — 익명 대화**
   - 메시지, 답장, 리액션, 여러 장의 사진.
4. **13~18초 — 방장 관리**
   - 공지, 규칙, 비밀번호, 얼리기, 금지어·차단을 빠르게 보여준다.
5. **18~23초 — 비밀 메시지**
   - 사용자 → 방장으로만 이동하고 발신자 화면에서는 정리되는 흐름.
6. **23~27초 — 라이브**
   - 임시 세션, 리액션 프리셋, 종료 후 세션 메시지 삭제.
7. **27~30초 — 엔드 카드**
   - `yap.` / `BETA` / `yapndot.com`

```text
Produce a 30-second vertical product-explainer video for "yap.", a link-based anonymous chat service. Use actual product screenshot placeholders for every UI scene and build only the surrounding environment, device frames, transitions and emphasis graphics. Visual identity: white #FFFFFF, blue #007AFF, message blue #3B8DF0, soft gray #F4F4F4, dark variant #000000 and #1C1C1E, modern rounded messenger layout, thin line icons and restrained motion.

Tell a clear cause-and-effect story: a channel owner creates a simple room, copies a /ch/ link, another person opens it without login, anonymous messages and reactions arrive, then the owner uses passcode, notice, rules and freeze controls. Show an owner-only private message as a one-way visual path to the owner, not as public chat. Transition to a distinct live-session state with a subtle live indicator and preset reactions; when the live session ends, remove only the live-session bubbles and return to the normal chat state. Finish with an uncluttered logo card.

Use macro UI camera moves, straight-on screen perspective, match cuts, 250–400ms transitions, subtle 8–16px message entrances, clear hierarchy, large safe margins, and no more than one feature focus per shot. Reserve blank typography areas; all Korean copy, logo text and product UI will be added accurately in post. The result should feel trustworthy, intimate, youthful and polished, not secretive or risky.

Avoid Apple branding, copied Messages assets, fake readable text, hacker motifs, masks, security guarantees, public channel discovery, cryptocurrency visuals, loud neon, excessive bounce, crowded feature collages and claims that normal chat messages automatically disappear.
```

## 8. 실제 화면 캡처 체크리스트

홍보 제작 전에 아래 데모 화면을 준비하면 이미지와 영상에 반복 활용할 수 있다.

- 라이트모드 대시보드: 소유 채널 1개, 참여 채널 2~3개
- 다크모드 대시보드
- 링크 공유 아이콘과 `/ch/demo-room` 주소
- 비밀번호 입력 화면과 짧은 힌트
- 일반 채팅: 텍스트, 답장, 리액션, 이미지 묶음
- 공지 배너와 채널 규칙 아이콘
- 방장 전용 DM 예시
- 채팅 얼리기 상태
- 라이브 시작 전·진행 중·종료 직후
- 갤러리와 링크 패널
- 단색 배경과 이미지 배경 채널 각각 1개

데모 문구 예시:

- 채널명: `오늘의 상영회`, `after party`, `우리끼리 질문함`
- 일반 메시지: `링크 잘 들어왔어?`, `응, 로그인 없이 바로 됐어`, `끝나고 라이브 열자`
- DM: `이 메시지는 방장에게만 보여요.`
- 공지: `서로를 존중하며 편하게 이야기해 주세요.`
- 라이브 제목: `같이 보는 중`

실제 이메일, 사용자 이름, 운영 채널 주소, 신고 내용과 인증정보는 캡처하지 않는다.

## 9. 플랫폼별 출력 규격

| 용도 | 비율 | 권장 크기 | 핵심 배치 |
|---|---:|---:|---|
| Instagram 피드 | 4:5 | 1080×1350 | 상단 카피, 중앙 UI, 하단 주소 |
| Instagram/Reels/TikTok | 9:16 | 1080×1920 | 위·아래 UI 안전영역 확보 |
| X/커뮤니티 공유 | 16:9 | 1600×900 | 왼쪽 카피, 오른쪽 제품 화면 |
| 정사각 카드 | 1:1 | 1080×1080 | 기능 한 개 또는 세 카드 |
| 웹 히어로 | 16:9 또는 3:2 | 1920×1080 이상 | CTA와 UI가 겹치지 않게 분리 |

숏폼 영상에서는 상단 약 250px, 하단 약 320px을 플랫폼 UI가 가릴 수 있는 영역으로 보고 핵심 문구와 버튼을 배치하지 않는다.

## 10. 최종 검수 체크리스트

- [ ] 서비스명이 모든 장면에서 정확히 `yap.`으로 표기되었는가?
- [ ] `yapndot.com` 철자가 정확한가?
- [ ] 링크 기반 입장과 익명 참여가 3초 안에 이해되는가?
- [ ] 로그인 없이 참여하는 사용자와 로그인하는 방장의 역할을 혼동하지 않는가?
- [ ] 실제 제품 UI와 현재 제공 기능만 사용했는가?
- [ ] 라이브 메시지 삭제를 일반 채팅 삭제로 오해하게 만들지 않았는가?
- [ ] DM의 가시성을 “방장에게만 보임”으로 정확히 설명했는가?
- [ ] 베타 라벨과 채널 생성 제한 가능성을 필요한 곳에 표시했는가?
- [ ] Apple 또는 다른 메신저의 로고·고유 자산을 사용하지 않았는가?
- [ ] AI가 만든 깨진 글자 대신 실제 타이포그래피와 스크린샷을 합성했는가?
- [ ] 실제 사용자 개인정보와 운영 데이터가 노출되지 않았는가?
- [ ] 작은 모바일 화면에서도 카피가 한 번에 읽히는가?

