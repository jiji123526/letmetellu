# Next.js + Worker Edge 아키텍처 학습 가이드

> Status: Current reference
>
> Last reviewed: 2026-09-11
>
> Scope: 브라우저, Next.js, Cloudflare Worker, D1, Durable Object, R2,
> Cache API가 어떻게 역할을 나누고 함께 동작하는지 설명한다.

## 이 문서의 목적

이 문서는 아래 구조를 "그냥 서비스가 돌아가는 그림"이 아니라, 왜 이렇게
나누는지와 어디에서 일관성, 성능, 보안 경계가 생기는지까지 이해하는 것을
목표로 한다.

```text
사용자 브라우저
    |
    | HTTPS / WebSocket
    v
Next.js on Vercel
    |
    | 인증된 내부 요청
    v
Cloudflare Worker
    |
    +---- D1: 관계형 데이터
    |
    +---- Durable Object: 채널별 실시간 조정
    |
    +---- R2: 이미지 원본
    |
    +---- Cache API: 임시 응답 캐시
```

다만 이 저장소의 실제 구현은 위 그림보다 조금 더 정확하게 보면 다음과 같다.

```text
브라우저 -- 페이지/일반 API --> Next.js on Vercel
브라우저 -- WebSocket -------> Cloudflare Worker -> Durable Object
Next.js -- 내부 인증 헤더 ---> Cloudflare Worker -> D1 / R2 / Cache / Durable Object
```

즉, 페이지 렌더링과 인증 세션 관리는 주로 Next.js가 담당하지만, 실시간
WebSocket 연결은 브라우저가 Worker로 직접 붙는다. 이 차이를 이해해야
"왜 Next.js와 Worker를 둘 다 두는가"가 선명해진다.

## 한 문장 요약

이 구조는:

- `Next.js`를 사용자-facing 웹 애플리케이션과 세션 경계로 쓰고,
- `Cloudflare Worker`를 권한 검사와 API 실행의 엣지 백엔드로 쓰고,
- `D1`을 영속적 정답 데이터의 저장소로 쓰고,
- `Durable Object`를 채널별 실시간 조정자처럼 쓰고,
- `R2`를 큰 바이너리 파일 저장소로 쓰고,
- `Cache API`를 비정답성 임시 캐시로 쓰는 구조다.

핵심은 "정답 데이터의 위치"와 "실시간 연결의 조정 위치"를 분리하는 데 있다.

## 각 계층이 맡는 책임

| 계층 | 주 책임 | 여기서 하지 않는 일 |
| --- | --- | --- |
| 브라우저 | UI 렌더링, 사용자 입력, WebSocket 연결 유지 | 최종 권한 판단, 정답 데이터 저장 |
| Next.js on Vercel | 페이지 렌더링, Auth.js 세션 확인, 서버 측 API 프록시 | 실시간 채널 fan-out, 대용량 객체 저장 |
| Cloudflare Worker | 권한 재검증, API 실행, 데이터 읽기/쓰기, 업로드/미리보기 처리 | 장기 세션 UI 관리 |
| D1 | 메시지, 채널, 설정, 지원/운영 데이터 같은 관계형 영속 데이터 | WebSocket 연결 상태 관리 |
| Durable Object | 채널 단위 WebSocket 연결, live presence, 일부 rate limit/접근 상태 | 장기 히스토리 저장, 복잡한 관계형 쿼리 |
| R2 | 이미지 원본, 채널 배경, 프로필 이미지 같은 바이너리 객체 | 권한 모델의 최종 판정 |
| Cache API | 미리보기 응답, 공개 배경처럼 재계산 비용이 있는 파생 결과 캐시 | 정답 데이터의 canonical 저장 |

## 왜 굳이 Next.js와 Worker를 분리하나

이 질문이 가장 중요하다. 하나의 서버에 다 넣을 수도 있기 때문이다.

### 1. 웹 애플리케이션과 API 실행 환경의 관심사를 분리한다

Next.js는 페이지, 세션, 라우팅, 서버 컴포넌트, 브라우저용 API 경계를 다루기에
좋다. 반면 Worker는 엣지에서 빠르게 실행되고 Cloudflare의 D1, R2, Durable
Object 바인딩을 자연스럽게 사용할 수 있다.

즉:

- Next.js는 "웹 앱의 입구"에 가깝고,
- Worker는 "엣지 API 실행기"에 가깝다.

### 2. 브라우저가 직접 신뢰되면 안 되기 때문이다

브라우저는 사용자 소유 환경이다. 헤더를 조작할 수 있고, 요청을 재생할 수 있고,
쿠키가 탈취될 수도 있다. 그래서:

- 브라우저는 세션 쿠키를 Next.js에 보낸다.
- Next.js는 서버에서 세션을 확인한다.
- Next.js는 그 결과를 내부 비밀과 함께 Worker에 전달한다.
- Worker는 그것만 믿지 않고 자신의 데이터 기준으로 다시 검사한다.

이중 검증이 보안 경계를 만든다.

### 3. WebSocket 실시간 경로는 HTTP 페이지 경로와 성격이 다르다

실시간 채팅은:

- 연결을 오래 유지해야 하고,
- 같은 채널 사용자들끼리 상태를 공유해야 하고,
- 새 메시지를 여러 클라이언트에 fan-out 해야 한다.

이건 일반적인 "요청 하나 받고 응답 하나 반환" 형태와 다르다. Durable Object는
이런 채널 단위 조정에 적합하다.

## 이 저장소에서 실제로 어떻게 구현되어 있나

코드를 읽을 때는 아래 순서가 가장 이해가 빠르다.

1. [README](../../README.md)
2. [Next.js 데이터 프록시](../../src/app/api/data/route.ts)
3. [Next.js WebSocket 토큰 발급 경로](../../src/app/api/ws-token/route.ts)
4. [Next.js 업로드 프록시](../../src/app/api/upload/route.ts)
5. [Worker 엔트리](../../worker/src/index.ts)
6. [Durable Object](../../worker/src/realtime/chat-room.ts)
7. [소켓 권한 판정](../../worker/src/routes/socket-auth.ts)
8. [업로드 처리](../../worker/src/routes/upload.ts)
9. [미리보기 캐시](../../worker/src/routes/preview.ts)
10. [채널 DB 라우팅 추상화](../../worker/src/lib/database-access.ts)

## 요청 흐름 1: 페이지와 일반 데이터 읽기

가장 기본적인 흐름은 "브라우저가 페이지를 열고, 채널 데이터와 타임라인을
읽는 것"이다.

### 단계별 흐름

1. 브라우저가 Next.js 페이지를 연다.
2. Next.js는 Auth.js 세션과 쿠키를 읽는다.
3. 브라우저가 `/api/data` 또는 `/api/unified-timeline` 같은 Next.js API를 호출한다.
4. Next.js는 요청을 Worker로 프록시한다.
5. 이때 서버가 확인한 사용자 정보와 room token, anonymous token 등을 함께 전달한다.
6. Worker는 자신의 권한 로직으로 다시 검증한다.
7. Worker가 D1에서 데이터를 읽고 JSON을 반환한다.
8. Next.js는 필요하면 미디어 접근용 서명을 덧붙여 브라우저에 반환한다.

### 왜 브라우저가 Worker를 직접 호출하지 않나

가능은 하지만 이 프로젝트는 일반 데이터 읽기에서 Next.js를 경계로 둔다.
그 이유는:

- Auth.js 세션은 Next.js 쪽이 가장 자연스럽게 다룬다.
- 서버만 아는 `INTERNAL_SECRET`을 이용해 내부 요청임을 증명할 수 있다.
- 브라우저에는 노출하면 안 되는 인증 결정을 서버에서 내릴 수 있다.
- 응답 직전에 미디어 접근 서명 같은 후처리를 추가하기 쉽다.

### 코드상 근거

[src/app/api/data/route.ts](../../src/app/api/data/route.ts)와
[src/app/api/unified-timeline/route.ts](../../src/app/api/unified-timeline/route.ts)를
보면 Next.js가 Worker로 요청을 보낼 때:

- `X-Internal-Token`
- `X-User-Id`
- `X-Room-Token`
- `X-Anonymous-Token`
- `X-Channel-Read-Token`

같은 헤더를 붙인다.

여기서 중요한 점은 `X-User-Id`만으로는 신뢰할 수 없고,
`X-Internal-Token`까지 맞아야 Worker가 "이건 Next.js 서버가 보낸 내부 요청"으로
판단할 수 있다는 것이다.

## 요청 흐름 2: WebSocket 연결과 실시간 인증

이 부분이 이 구조의 핵심이다. 많은 사람이 "WebSocket은 연결만 열면 끝"이라고
생각하지만, 실제로는 연결 자체와 권한 확정이 분리되어 있다.

### 실제 흐름

1. 브라우저가 Worker의 `/ws/:channel`로 WebSocket 연결을 연다.
2. Worker는 해당 채널 이름으로 Durable Object 인스턴스를 찾는다.
3. Durable Object는 소켓을 받되, 처음부터 완전한 권한을 주지 않을 수 있다.
4. 브라우저는 별도로 Next.js의 `/api/ws-token`을 호출한다.
5. Next.js는 세션과 room token 등을 들고 Worker의 `/api/socket-auth`를 호출한다.
6. Worker는 이 사용자가 owner인지, passcode가 있는 방의 viewer인지, 익명
   room viewer인지 판단한다.
7. Next.js는 그 결과를 바탕으로 짧은 TTL의 WebSocket 토큰을 HMAC으로 서명해
   브라우저에 돌려준다.
8. 브라우저는 그 토큰을 WebSocket 메시지로 다시 Durable Object에 보낸다.
9. Durable Object는 토큰을 검증하고 연결을 authorized 상태로 전환한다.
10. 그 뒤부터만 브로드캐스트, live join, typing 같은 이벤트가 제대로 동작한다.

### 왜 이렇게 복잡하게 하나

이유는 단순하다. WebSocket 연결은 오래 살아 있고, 한 번 붙은 뒤에는 수많은
이벤트가 오간다. 따라서:

- 연결을 연 시점의 권한,
- 채널 비밀번호 상태,
- 현재 live session 상태,
- owner/admin/viewer 구분

을 분리해서 다뤄야 한다.

즉, "HTTP에서 1회 인증하고 끝"이 아니라 "소켓의 수명 동안 어떤 권한으로
행동할 수 있는가"를 별도 모델로 관리한다.

### 코드상 근거

- 브라우저 reconnect/auth 로직: [src/hooks/useRealtime.ts](../../src/hooks/useRealtime.ts)
- Next.js 토큰 발급: [src/app/api/ws-token/route.ts](../../src/app/api/ws-token/route.ts)
- Worker 권한 판정: [worker/src/routes/socket-auth.ts](../../worker/src/routes/socket-auth.ts)
- Durable Object 토큰 검증과 fan-out: [worker/src/realtime/chat-room.ts](../../worker/src/realtime/chat-room.ts)
- 토큰 형식 검증: [worker/src/lib/admin-ws-token.ts](../../worker/src/lib/admin-ws-token.ts)

### Durable Object가 특별히 하는 일

이 프로젝트에서 Durable Object는 메시지 영속 저장소가 아니다. 대신:

- 채널별 WebSocket 연결 집합 유지
- live 참여자 수 계산
- 접근 상태 변경 시 소켓 권한 갱신
- 채널 범위 rate limit 일부 저장
- D1에 기록된 변경사항을 connected clients에 브로드캐스트

를 담당한다.

이 차이는 중요하다. Durable Object는 "조정자"이고, D1은 "기록 저장소"다.

## 요청 흐름 3: 메시지 쓰기와 실시간 fan-out

실시간 채팅에서 가장 자주 일어나는 일은 메시지 쓰기다.

이 구조의 일반 원칙은:

1. 권한과 유효성 검사는 Worker HTTP 경로에서 수행한다.
2. 정답 데이터는 D1에 먼저 쓴다.
3. 쓰기가 성공한 뒤 Durable Object에 브로드캐스트를 요청한다.

이 순서를 지키는 이유는 "실시간 이벤트는 파생 결과이고, 정답은 DB에 있다"는
원칙 때문이다. 반대로 먼저 브로드캐스트하고 나중에 DB 쓰기가 실패하면,
사용자는 본 메시지를 나중에 다시 못 찾는 이상한 상태를 보게 된다.

[worker/src/routes/messages.ts](../../worker/src/routes/messages.ts)와
[worker/src/routes/dm.ts](../../worker/src/routes/dm.ts)를 보면 D1 기록 후
`CHAT_ROOM.get(...).fetch("http://internal/broadcast")` 패턴으로 Durable Object에
이벤트 전달을 요청하는 흐름이 반복된다.

## 요청 흐름 4: 이미지 업로드와 미디어 제공

텍스트와 바이너리를 같은 저장소에 넣지 않는 이유도 이해해야 한다.

### 왜 R2가 필요한가

이미지 원본은:

- 크기가 크고,
- DB row보다 접근 패턴이 다르고,
- HTTP 캐싱이 잘 맞고,
- 메타데이터와 원본 바이너리를 분리하는 편이 운영에 유리하다.

따라서 객체 저장소인 R2가 적합하다.

### 업로드 단계

1. 브라우저가 Next.js `/api/upload`로 업로드한다.
2. Next.js는 세션, room token, anonymous token, client IP 등을 정리해서 Worker에 전달한다.
3. Worker는 owner 업로드인지, 익명 사용자 업로드인지, passcode가 필요한 채널인지 검사한다.
4. Worker는 크기, content-type, 시그니처를 검증한다.
5. Worker는 바이너리를 R2에 저장한다.
6. 메시지 첨부용이라면 D1에 upload ticket/메타데이터를 남긴다.

### 왜 D1도 같이 쓰나

R2에는 파일 바이트가 있지만, 서비스 의미는 없다. 예를 들면:

- 이 파일이 어떤 채널 소속인가
- 아직 메시지에 attach되지 않은 임시 업로드인가
- 누가 올렸는가
- 만료되었는가
- 어떤 권한으로 읽어야 하는가

이런 정보는 D1 같은 관계형 저장소가 다루기 쉽다.

### 코드상 근거

- Next.js 업로드 프록시: [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts)
- Worker 업로드/미디어 서빙: [worker/src/routes/upload.ts](../../worker/src/routes/upload.ts)

## D1은 정확히 어떤 역할인가

D1은 이 구조에서 "정답 데이터의 중심"이다.

이 저장소의 설명을 기준으로 D1에는 대략 다음이 들어간다.

- 계정과 인증 상태
- 채널 설정
- 메시지와 답글
- DM
- moderation 데이터
- support / report / audit 데이터
- upload ticket
- 알림 및 운영 관련 데이터

중요한 점은 D1이 단순 key-value 저장소가 아니라 관계형 데이터베이스라는 것이다.
즉:

- foreign key
- indexed query
- filter / join에 가까운 질의
- 정렬과 pagination
- 트랜잭션

같은 작업에 맞는다.

### 왜 메시지를 Durable Object에만 넣지 않나

가능은 하지만 비용이 크다.

Durable Object만으로 장기 히스토리를 들고 가면:

- 검색과 pagination이 어려워지고,
- 운영 SQL과 분석이 약해지고,
- 데이터 이행과 마이그레이션이 복잡해지고,
- 오프라인/재접속 시 히스토리 재구성이 어려워진다.

그래서 이 프로젝트는 "실시간 조정은 DO, 영속 히스토리는 D1"이라는 분리를
선택했다.

### 진화 포인트

[worker/src/lib/database-access.ts](../../worker/src/lib/database-access.ts)는 현재는
사실상 `env.DB` 하나만 반환하지만, 구조상 `resolveChannelDatabase()`를 따로 둬서
나중에 채널별 shard 라우팅으로 확장할 수 있게 해 둔다. 이건 "지금은 단일 DB지만,
모든 호출 지점을 미래 파편화 가능성에 맞춰 정리해 둔 상태"라고 보면 된다.

## Durable Object는 정확히 어떤 역할인가

Durable Object를 이해할 때 가장 유용한 비유는 "채널별 actor"다.

이 actor는:

- 같은 채널에 대한 동시성 조정 지점이 하나로 모이고,
- 메모리/스토리지에 짧은 상태를 들고 있을 수 있고,
- 그 채널 WebSocket 연결을 한곳에서 관리할 수 있다.

이 저장소의 ChatRoom Durable Object는 특히 다음 역할에 잘 맞는다.

- 채널별 fan-out
- live session 참가 수
- passcode 변경 시 접근 취소/갱신
- 채널 범위 rate limit

반대로 DO에 잘 안 맞는 일은:

- 전역 검색
- 장기 보고용 질의
- 다수 채널을 넘나드는 관계형 분석

이다.

## Cache API는 왜 따로 두나

Cache API는 "정답 저장소"가 아니라 "계산 결과 재사용 레이어"다.

이 구분을 놓치면 아키텍처를 잘못 이해하게 된다.

### Worker Cache API

Worker에서는 `caches.default`를 이용해:

- 링크 미리보기 응답
- 공개 채널 배경 같은 읽기 결과

를 임시 캐시한다.

코드상으로는:

- [worker/src/routes/preview.ts](../../worker/src/routes/preview.ts)
- [worker/src/lib/public-background-cache.ts](../../worker/src/lib/public-background-cache.ts)

가 대표적이다.

이 캐시의 성격은 다음과 같다.

- 없어도 서비스는 동작해야 한다.
- 틀린 권한 결정이 들어가면 안 된다.
- TTL이 끝나면 다시 계산/조회하면 된다.
- 데이터 정합성의 최종 책임을 지지 않는다.

### 브라우저 Cache API와의 차이

이 저장소는 브라우저 측 Cache API도 쓴다. 예를 들면 링크 미리보기는
[src/components/chat/MessageEmbeds.tsx](../../src/components/chat/MessageEmbeds.tsx)에서
브라우저 캐시를 사용한다.

둘의 차이는:

- Worker Cache API: edge에서 여러 사용자가 공유할 수 있는 응답 캐시
- Browser Cache API: 개별 사용자의 기기에 남는 로컬 캐시

즉, 이름은 같아도 위치와 책임이 다르다.

## 인증된 내부 요청은 무엇을 의미하나

이 구조를 이해할 때 꼭 알아야 할 개념이 "front channel"과 "back channel"의 분리다.

- front channel: 브라우저와 서버 사이의 공개 요청 경로
- back channel: 서버와 서버 사이의 내부 요청 경로

여기서:

- 브라우저는 세션 쿠키나 room token만 가진다.
- Next.js는 서버이므로 `INTERNAL_SECRET`을 안다.
- Worker는 `INTERNAL_SECRET`이 맞는 요청만 내부 신뢰 요청으로 취급한다.

즉, 사용자가 개발자 도구에서 `X-User-Id: someone-else`를 붙여도
`X-Internal-Token`이 없으면 믿지 않는다.

이 패턴의 장점은:

- 브라우저에 장기 비밀을 주지 않는다.
- Worker가 사용자 신원을 재구성할 때 신뢰 가능한 서버 서명을 활용한다.
- Next.js와 Worker가 책임을 나눠도 권한 모델이 깨지지 않는다.

## 이 구조의 보안 경계

보안 관점에서 보면 이 시스템은 여러 겹의 경계를 가진다.

### 1. Origin 경계

Worker는 허용된 origin만 받도록 설정한다.

- 관련 파일: [worker/wrangler.toml](../../worker/wrangler.toml),
  [worker/src/index.ts](../../worker/src/index.ts)

### 2. 세션 경계

로그인 세션은 Next.js/Auth.js가 확인한다.

### 3. 내부 서버 신뢰 경계

Next.js에서 Worker로 넘어갈 때 `INTERNAL_SECRET`이 붙는다.

### 4. 채널 접근 경계

passcode가 있는 채널은 room token 없이는 읽기/소켓 권한이 확정되지 않는다.

### 5. 익명 사용자 경계

익명 사용자도 완전 무기명 문자열이 아니라 서명된 anonymous identity를 가진다.
그래야 자신의 DM 루트나 업로드 한도를 안정적으로 추적할 수 있다.

### 6. 미디어 접근 경계

R2 객체가 있다고 해서 아무나 읽을 수 있는 것이 아니다. 미디어 제공 경로는
필요하면 접근 토큰과 채널 권한을 다시 확인한다.

## 성능과 일관성 관점에서 왜 이 구성이 맞는가

이 구조는 사실 세 가지 문제를 동시에 풀려는 시도다.

### 1. 느슨한 페이지 경로와 빠른 실시간 경로를 분리한다

페이지/API는 Next.js를 통해 세션 친화적으로 처리하고, 실시간은 Worker + DO로
직행시킨다. 이 덕분에 WebSocket fan-out이 Vercel 서버 프로세스에 묶이지 않는다.

### 2. 정답 데이터와 임시 상태를 분리한다

- D1: 재시작 후에도 남아야 하는 것
- DO 메모리/스토리지: 지금 연결된 사람과 잠깐 필요한 상태
- Cache API: 다시 만들어도 되는 것

이 구분이 명확할수록 장애 시 복구가 쉬워진다.

### 3. 큰 바이너리와 작은 메타데이터를 분리한다

- R2: 바이트 저장
- D1: 의미와 권한 저장

이건 거의 모든 미디어 서비스에서 반복되는 기본 패턴이다.

## 이 구조의 장점

- 웹 앱 프레임워크와 엣지 데이터 경로의 장점을 동시에 취할 수 있다.
- 채널별 실시간 fan-out을 Durable Object 하나로 수렴시킬 수 있다.
- 메시지 히스토리와 운영 데이터는 관계형 DB로 유지할 수 있다.
- 업로드와 미디어 제공을 DB와 분리해 확장하기 쉽다.
- 캐시를 적극적으로 쓰되 권한 정답은 캐시에 의존하지 않도록 설계할 수 있다.

## 이 구조의 비용과 주의점

- Vercel과 Cloudflare를 같이 쓰므로 사고모델이 단일 플랫폼보다 복잡하다.
- 서버 간 홉이 추가되므로 모든 API를 무조건 프록시하면 지연이 늘 수 있다.
- 권한 모델이 HTTP, WebSocket, 미디어 경로마다 일관되게 유지되어야 한다.
- 캐시 계층이 늘수록 "무엇이 정답인가"를 팀이 명확히 공유해야 한다.
- Durable Object는 강력하지만 전역 DB 대체재가 아니다.

## 언제 좋은 선택이고, 언제 과한 선택인가

### 잘 맞는 경우

- 채널/룸/문서 단위 실시간 협업이 있다.
- 메시지 히스토리나 설정을 관계형으로 다뤄야 한다.
- 업로드 미디어가 존재한다.
- 익명 사용자와 로그인 사용자가 섞여 있다.
- 엣지에서 빠르게 처리하고 싶은 API가 있다.

### 과한 경우

- 그냥 CRUD 중심의 작은 대시보드다.
- 실시간 연결이 거의 없다.
- 채널 단위 동시성 조정이 필요 없다.
- 객체 저장소와 별도 권한 계층이 필요할 정도의 미디어가 없다.

## 학습할 때 자주 생기는 오해

### 오해 1. Durable Object가 있으면 DB가 필요 없다

아니다. DO는 coordination에 강하고, D1은 durable queryable data에 강하다.

### 오해 2. Cache API에 들어가면 정답 데이터다

아니다. 캐시는 파생 결과의 재사용일 뿐이다.

### 오해 3. WebSocket 연결이 열렸으면 이미 인증됐다

아니다. 이 저장소는 연결과 권한 확정을 분리한다.

### 오해 4. Next.js가 세션을 확인했으니 Worker는 믿기만 하면 된다

아니다. Worker는 자신의 데이터 기준으로 다시 판단해야 한다.

### 오해 5. R2가 있으니 권한 검사는 필요 없다

아니다. 객체 저장소는 저장 위치일 뿐, 접근 정책 자체를 대신하지 않는다.

## 이 구조를 공부하는 추천 순서

1. HTTP 요청과 쿠키, 세션, CORS, Origin을 먼저 이해한다.
2. WebSocket이 HTTP upgrade 뒤에 별도 상태 기계가 된다는 점을 이해한다.
3. 관계형 DB와 객체 저장소의 역할 분리를 이해한다.
4. actor/coordination 개념으로 Durable Object를 이해한다.
5. 마지막으로 캐시와 TTL, stale data, invalidation trade-off를 학습한다.

이 순서를 지키면 "왜 이 기술이 필요한가"가 자연스럽게 이어진다.

## 추천 자료

아래 자료들은 "이 구조를 구성하는 개념"을 배우기에 실제로 많이 추천되는
자료들이다. 공식 문서와 널리 읽히는 책을 섞어서 정리했다.

### 1. 네트워크와 웹 전송 기초

1. Ilya Grigorik, *High Performance Browser Networking*
   HTTPS, TCP, 브라우저 요청 흐름, 성능 관점의 기본기를 익히기에 좋다.
2. Kurose & Ross, *Computer Networking: A Top-Down Approach*
   HTTP, TLS, 연결 모델을 체계적으로 배우기 좋다.
3. RFC 9110, *HTTP Semantics*
   HTTP가 무엇을 보장하는지 원문 기준으로 이해하고 싶을 때 좋다.
4. RFC 9111, *HTTP Caching*
   캐시 제어 헤더와 재검증 모델을 제대로 이해하는 데 유용하다.

### 2. 실시간과 WebSocket

1. RFC 6455, *The WebSocket Protocol*
   WebSocket이 정확히 어떻게 성립하는지 알고 싶을 때 가장 직접적이다.
2. MDN Web Docs, *WebSocket API*
   브라우저 관점에서 빠르게 실용 감각을 잡기 좋다.

### 3. 데이터 모델과 일관성

1. Martin Kleppmann, *Designing Data-Intensive Applications*
   이 문서의 거의 모든 핵심 주제, 즉 consistency, replication, storage,
   events, indexes, durability를 가장 잘 묶어 설명하는 책이다.
2. Michael T. Nygard, *Release It!*
   장애, 실패 전파, 운영 현실을 배우기에 좋다. 캐시나 외부 의존성에 대한
   방어적 설계 감각을 키우는 데 유용하다.

### 4. 이 아키텍처에 직접 대응되는 공식 문서

1. Next.js 공식 문서
   App Router, Route Handlers, caching, server/client 경계를 이해하는 기본 자료다.
2. Vercel 공식 문서
   배포 모델과 edge/network 경계를 이해하는 데 도움이 된다.
3. Cloudflare Workers 공식 문서
   Worker 실행 모델, fetch handler, bindings를 이해하는 출발점이다.
4. Cloudflare Durable Objects 공식 문서
   actor-like coordination을 이해하는 핵심 자료다.
5. Cloudflare D1 공식 문서
   D1의 제약, 세션, 읽기/쓰기 모델을 이해하는 데 필요하다.
6. Cloudflare R2 공식 문서
   객체 저장, 메타데이터, 캐싱 관점을 배우기에 적합하다.
7. Cloudflare Cache API 공식 문서
   `caches.default`가 어떤 계층에서 어떻게 동작하는지 확인할 수 있다.

### 5. 읽는 방법 추천

가장 효율적인 순서는 대개 이렇다.

1. `High Performance Browser Networking`
2. MDN의 HTTP caching / WebSocket 문서
3. `Designing Data-Intensive Applications`
4. Next.js 공식 문서의 Route Handlers와 caching
5. Cloudflare Workers -> Durable Objects -> D1 -> R2 문서 순서
6. 그 뒤에 이 저장소 코드를 다시 읽기

이 순서로 보면 "기술 이름"이 아니라 "문제를 푸는 방식"으로 아키텍처가 보이기
시작한다.

## 마지막 정리

이 구조를 정말 이해하려면 기술별 정의를 외우는 것보다 아래 세 문장을 머리에
남기는 편이 낫다.

1. Next.js는 사용자 세션과 웹 애플리케이션 경계다.
2. Worker는 권한 검사와 데이터 접근의 엣지 백엔드다.
3. D1은 정답, Durable Object는 조정, R2는 바이너리, Cache API는 임시 재사용이다.

이 네 역할을 섞지 않으면, 아키텍처는 훨씬 이해하기 쉬워진다.
