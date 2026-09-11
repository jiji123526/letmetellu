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

## Q&A

### Q. Next.js는 정확히 무엇이고, 왜 이 구조에서 필요한가

`Next.js`는 `React` 위에 올라가는 웹 애플리케이션 프레임워크다. 화면
컴포넌트만 만드는 것이 아니라:

- 라우팅
- 서버 렌더링
- 정적 생성
- API route
- 세션/쿠키 기반 서버 로직

같은 웹 애플리케이션의 바깥 구조를 함께 제공한다.

배경을 보면 `React` 자체는 UI 라이브러리이기 때문에, 서비스용 웹 앱을 만들려면
서버 렌더링, 라우팅, 빌드, 배포 구성을 따로 붙여야 했다. `Next.js`는 이 문제를
줄이기 위해 `Vercel`(당시 `ZEIT`)이 2016년 무렵부터 발전시킨 프레임워크다.

이 프로젝트에서 `Next.js`는 주로:

- 웹 앱 셸
- Auth.js 세션 경계
- 브라우저용 API 경계
- Worker 앞단의 신뢰 가능한 서버 프록시

역할을 맡는다. 즉, 실시간 채팅 백엔드 그 자체라기보다 브라우저와 Worker 사이의
안전한 서버 계층에 가깝다.

### Q. SSR은 무엇이고, 이 프로젝트에서 왜 중요하나

`SSR(Server-Side Rendering)`은 서버가 먼저 HTML을 만들어 브라우저에 보내는
방식이다. 반대로 `CSR(Client-Side Rendering)`은 브라우저가 JavaScript를
실행한 뒤 화면을 만든다.

SSR이 중요한 이유는:

- 첫 화면 표시
- 검색 엔진 친화성
- 공유 링크용 메타데이터
- 세션/쿠키 기반 초기 분기

를 서버에서 먼저 처리할 수 있기 때문이다.

다만 이 프로젝트는 "모든 채팅 화면을 SSR로 그리는 구조"는 아니다. 실제로는:

- 채널별 메타데이터 생성
- locale 결정
- 로그인 여부에 따른 redirect
- Worker로 넘어가기 전 서버 측 인증/서명

에 SSR/서버사이드의 가치가 집중되어 있다.

예를 들어:

- [src/app/ch/[slug]/page.tsx](../../src/app/ch/[slug]/page.tsx)는 채널별
  `generateMetadata()`를 서버에서 계산한다.
- [src/app/support/page.tsx](../../src/app/support/page.tsx)는 세션을 보고
  로그인 redirect를 서버에서 처리한다.

반면 실시간 채팅 본체는 이후 Worker API와 WebSocket을 통해 동작한다.

### Q. WebSocket은 무엇이고, 무엇을 하나

`WebSocket`은 브라우저와 서버가 연결을 한 번 맺은 뒤 그 연결을 유지하면서,
양쪽이 아무 때나 메시지를 보낼 수 있게 하는 프로토콜이다.

일반 HTTP는 보통:

1. 요청
2. 응답
3. 종료

모델이지만, WebSocket은:

1. 연결 수립
2. 연결 유지
3. 양방향 메시지 교환

모델이다.

이 프로젝트에서 WebSocket은:

- 새 메시지 실시간 반영
- live presence
- typing 이벤트
- live 시작/종료 이벤트
- 권한 상태 변경 통지

에 쓰인다.

브라우저 측 연결/재연결 로직은
[src/hooks/useRealtime.ts](../../src/hooks/useRealtime.ts)에 있고, 채널별 소켓
조정은 [worker/src/realtime/chat-room.ts](../../worker/src/realtime/chat-room.ts)가
담당한다.

### Q. WebSocket handshake는 실제로 어떻게 생기나

WebSocket은 처음부터 완전히 다른 프로토콜로 시작하지 않는다. 먼저 HTTP 요청을
보낸 뒤, 서버가 이를 `Upgrade` 해 주면 WebSocket으로 전환된다.

개념적으로는 이런 흐름이다.

브라우저:

```http
GET /ws/my-channel HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
Sec-WebSocket-Version: 13
Origin: https://yapndot.com
```

서버:

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: ...
```

여기서 `101 Switching Protocols`가 오면 이후에는 일반 HTTP body가 아니라
WebSocket 프레임이 오간다.

이 프로젝트에서는 [worker/src/realtime/chat-room.ts](../../worker/src/realtime/chat-room.ts)
가 `Upgrade` 요청을 받고, 그 다음부터는 소켓 메시지 단위로 인증과 이벤트를
처리한다.

### Q. Polling / Long Polling / SSE / WebSocket은 어떻게 다른가

- `Polling`
  브라우저가 주기적으로 계속 HTTP 요청을 보내 "새 소식 있나"를 묻는 방식이다.
  구현은 쉽지만 낭비가 많다.
- `Long Polling`
  요청을 보내면 서버가 새 이벤트가 생길 때까지 잠깐 붙잡고 있다가 응답한다.
  일반 polling보다 낫지만, 결국 요청을 반복해서 다시 열어야 한다.
- `SSE(Server-Sent Events)`
  서버가 브라우저로 단방향 이벤트 스트림을 계속 보낸다. 알림 스트림에는 좋지만
  브라우저에서 서버로 실시간 메시지를 보내는 데는 별도 요청이 필요하다.
- `WebSocket`
  연결을 한 번 맺고 양방향으로 계속 메시지를 보낸다. 채팅, typing, presence,
  live 제어 같은 상호작용에 가장 자연스럽다.

이 프로젝트는 브라우저도 즉시 `typing`, `join-live`, 인증 메시지를 보내야 하고,
서버도 `live-presence`, 새 메시지, 권한 변경 이벤트를 밀어야 하므로 `WebSocket`이
가장 잘 맞는다.

### Q. 왜 이 프로젝트에서 Durable Object + WebSocket 조합이 특히 잘 맞나

이 서비스는 "채널별로 여러 사용자가 동시에 붙는 구조"다. 따라서 채널마다:

- 현재 연결된 소켓 목록
- 누가 live에 있는지
- 누구에게 어떤 이벤트를 뿌릴지
- passcode 변경 시 누구 권한을 취소할지

를 한곳에서 조정하는 것이 유리하다.

`Durable Object`는 이 채널별 조정자 역할에 잘 맞는다. 실제로
[worker/src/realtime/chat-room.ts](../../worker/src/realtime/chat-room.ts)의
`ChatRoom`은:

- 채널별 연결 유지
- `/broadcast` fan-out
- live viewer count 계산
- passcode 변경 시 권한 철회
- 채널 범위 rate limit

을 담당한다.

짧게 말하면:

- `WebSocket`은 실시간 통신 채널이고,
- `Durable Object`는 그 채널의 방 관리자다.

### Q. Durable Object에 접근할 때 왜 항상 이름 -> ID -> 스텁 3단계를 거치나

이 3단계는 Durable Object의 `유일성`과 `라우팅`을 성립시키는 뼈대다.

첫 단계는 `이름 -> ID` 변환이다.

```ts
const doId = env.CHAT_ROOM.idFromName(channelId);
```

여기서 핵심은 `결정론적(deterministic)`이라는 점이다. 같은 이름을 넣으면 어느
Worker 인스턴스에서 계산하든 같은 ID가 나온다. 즉:

- 서울에서 계산해도 같은 ID
- 프랑크푸르트에서 계산해도 같은 ID
- 지금 계산해도, 나중에 계산해도 같은 ID

가 된다.

그래서 "채널 `abc`는 어디로 보내야 하지?"를 별도 전역 조정 서비스 없이도
일관되게 결정할 수 있다. 이게 Durable Object의 "이름이 곧 전역 주소"라는
감각이다.

두 번째 단계는 `ID -> 스텁`이다.

```ts
const stub = env.CHAT_ROOM.get(doId);
```

여기서 `stub`은 객체 자체가 아니라, 그 객체로 가는 `원격 참조(remote reference)`
다. 즉:

- `get()`을 했다고 곧바로 인스턴스가 생성되는 것은 아니고
- 실제 호출이 들어올 때 플랫폼이 해당 인스턴스를 찾거나 깨우거나 새로 만든다

고 이해하면 된다.

세 번째 단계는 `실제 호출`이다.

이 저장소는 현재 `RPC 메서드 호출`이 아니라 `fetch()` 스타일을 쓰고 있다.

```ts
const response = await stub.fetch(request);
```

예를 들면:

- WebSocket upgrade 진입:
  [worker/src/index.ts](../../worker/src/index.ts)
- 메시지 브로드캐스트:
  [worker/src/routes/messages.ts](../../worker/src/routes/messages.ts)
- live 종료 알림:
  [worker/src/lib/live-sessions.ts](../../worker/src/lib/live-sessions.ts)

에서 모두 같은 패턴을 쓴다.

즉 이 프로젝트의 실제 흐름은:

1. `channelId`를 이름으로 쓴다
2. `idFromName(channelId)`로 같은 채널의 DO ID를 얻는다
3. `get(doId)`로 스텁을 얻는다
4. `stub.fetch(...)`로 그 채널의 ChatRoom에 명령을 보낸다

이다.

### Q. "이름이 곧 경계"라는 말은 정확히 무슨 뜻인가

Durable Object에서 이름을 무엇으로 정하느냐가 곧:

- 어떤 단위가 같은 객체에 모일지
- 어떤 단위가 직렬화된 동시성 경계를 가질지
- 어떤 단위가 같은 메모리/상태를 공유할지

를 결정한다.

이 프로젝트는 `channelId`를 이름으로 쓴다. 즉:

- 같은 `channelId`의 모든 WebSocket 연결은 같은 `ChatRoom`으로 모이고
- 같은 채널의 broadcast, live presence, passcode 반영도 그 `ChatRoom`에서
  조정된다

반대로 이름을 `userId`로 잡았다면:

- 사용자당 하나의 DO
- 사용자별 상태나 inbox 같은 모델

이 더 자연스러웠을 것이다.

즉 이름 선택은 단순 식별자 선택이 아니라, 사실상:

- 상태 소유권
- 동시성 단위
- fan-out 단위
- 확장 단위

를 결정하는 설계다.

그래서 "이름이 곧 경계"라는 말이 나온다.

### Q. Durable Object를 크게 만들면 왜 안 되나

DO를 처음 쓸 때 가장 흔한 실수는 "강한 객체 하나에 많은 것을 몰아넣는 것"이다.
전통적인 서버에서는 큰 프로세스 하나가 많은 요청을 처리하는 사고방식이 자연스럽지만,
DO는 그 반대로 생각해야 한다.

핵심은:

- 인스턴스 하나는 작고 가볍게 유지하고
- 같은 종류의 인스턴스를 많이 만들고
- 부하는 인스턴스 수로 분산한다

는 점이다.

이유는 DO가 채널 단위로는 매우 편하지만, 인스턴스 하나 안에서는 사실상
직렬화된 실행 경계를 제공하기 때문이다. 즉, 같은 DO로 들어오는 요청은 안전성을
얻는 대신 처리량 상한도 공유한다.

예를 들어 어떤 DO 하나에 1초짜리 작업 100개가 몰리면, 뒤 요청들은 줄을 서게
된다. 이건 race condition을 줄여 주는 대신 "많이 몰리면 느려진다"는 대가를
가진다는 뜻이다.

### Q. 이 프로젝트는 DO를 어떻게 작게 유지하고 있나

이 프로젝트의 좋은 점은 `전역 ChatRoom 하나`를 만들지 않고, `채널당 ChatRoom 하나`
로 쪼갠다는 것이다.

실제로:

- WebSocket upgrade는 [worker/src/index.ts](../../worker/src/index.ts)에서
  `channelId`로 DO를 찾고
- 메시지 fan-out은 [worker/src/routes/messages.ts](../../worker/src/routes/messages.ts)에서
  `parentChannelId` 기준으로 해당 채널 DO에만 전달하고
- DM reply rate limit도 [worker/src/routes/dm.ts](../../worker/src/routes/dm.ts)에서
  같은 채널 DO로 보낸다

즉 구조가:

- 채널 A의 소켓/브로드캐스트/채널 rate limit
- 채널 B의 소켓/브로드캐스트/채널 rate limit

을 서로 다른 DO 인스턴스에 분산시킨다.

그래서 채널 A가 매우 바빠도 채널 B까지 같은 직렬 큐를 공유하지 않는다. 이게
"DO를 크게 만들지 말라"의 가장 실용적인 예다.

### Q. 이 프로젝트에서 만약 DO를 잘못 크게 만들면 어떤 일이 생기나

예를 들어 다음과 같은 설계는 안 좋은 방향이다.

#### 1. 모든 채널을 하나의 전역 ChatRoom에 몰아넣는 경우

만약 이름을 `channelId`가 아니라 항상 `"all-chats"`처럼 고정했다면:

- 모든 WebSocket 연결
- 모든 broadcast
- 모든 typing 이벤트
- 모든 live presence 변경
- 모든 채널 rate limit

이 한 인스턴스로 몰린다.

그러면 채널 A에서 큰 fan-out이 일어나는 동안 채널 B의 typing 이벤트도 같은 직렬
큐 뒤에서 기다려야 한다. 이건 실시간 시스템에서 매우 나쁜 병목이다.

#### 2. 모든 메시지 rate limit을 전역 DO 하나에서 처리하는 경우

현재는 [worker/src/routes/messages.ts](../../worker/src/routes/messages.ts)와
[worker/src/routes/dm.ts](../../worker/src/routes/dm.ts)에서 `parentChannelId` 기반의
채널 DO에 `channel-rate-limit`을 요청한다. 이 말은 채널별로 rate-limit 상태가
분리된다는 뜻이다.

만약 이를 `global-rate-limit` DO 하나로 처리했다면:

- 모든 채널의 모든 메시지 전송
- 모든 DM reply 전송

이 전부 한 인스턴스에 직렬화된다. 그러면 rate-limit 체크 자체가 플랫폼 전체의
목줄이 된다.

### Q. 그렇다면 DO에 넣어야 하는 것과 넣지 말아야 하는 것은 무엇인가

이 프로젝트 기준으로 보면 DO에 잘 맞는 것은:

- 채널별 WebSocket 연결 목록
- 채널별 broadcast
- 채널별 live presence
- 채널 범위의 짧은 상태
- 채널 범위 rate limit

이다.

반대로 DO에 덜 맞는 것은:

- 전역 운영 통계
- 전체 서비스 수준 합계
- 다수 채널을 한 번에 스캔해야 하는 질의
- 장기 보고용 집계

같은 것이다.

이 프로젝트에서도 전역 운영 상태는 DO가 아니라 D1 집계로 처리한다. 예를 들어
[worker/src/routes/support.ts](../../worker/src/routes/support.ts)의
`fetchPlatformOperationalHealth()`는 `operational_events` 테이블을 직접 집계해
15분/24시간 단위 운영 상태를 계산한다.

이건 올바른 선택이다. 이런 전역 집계를 DO 하나에 몰아 넣으면 "쉽게 쓰기"는
좋아 보여도, 결국 모든 기록이 한 직렬 인스턴스로 빨려 들어가는 병목이 된다.

### Q. 그러면 "전역 카운터"는 절대 DO에 넣으면 안 되나

절대 안 되는 것은 아니다. 다만 `전역 카운터 DO 하나`는 신중해야 한다.

트래픽이 작으면 단일 DO 하나로도 충분할 수 있다. 하지만 초당 쓰기 수가 커지면
그때는:

- 샤드 16개
- 샤드 64개
- 샤드 100개

처럼 여러 DO로 나누고, 읽을 때만 합산하는 방식이 더 안전하다.

즉 전역성이 필요한 데이터라도:

- 쓰기는 분산
- 읽기 때 합산

하는 사고방식이 DO 환경에서 자주 쓰인다.

### Q. 이 프로젝트에서 "잘 쪼갠 경계"의 핵심은 무엇인가

이 프로젝트의 핵심 경계는 `채널`이다.

그래서:

- 연결도 채널 기준
- broadcast도 채널 기준
- live presence도 채널 기준
- rate limit도 채널 기준

으로 맞춰져 있다.

이런 식으로 도메인 경계와 DO 경계를 맞추면, 각 인스턴스가 작고 독립적으로
움직이기 쉬워진다. DO 설계에서 가장 좋은 출발점은 "업무 도메인의 자연스러운
동시성 경계가 무엇인가"를 먼저 찾는 것이다.

### Q. WebSocket의 장점과 단점은 무엇인가

장점:

- 실시간성이 좋다.
- 서버가 먼저 push 할 수 있다.
- 채팅, presence, typing, live 상태에 잘 맞는다.
- polling보다 요청 낭비가 적다.

단점:

- 일반 HTTP보다 구현이 복잡하다.
- 인증과 권한 갱신을 별도로 설계해야 한다.
- 재연결, 순서, 중복, 끊김 복구를 신경 써야 한다.
- 운영 중 connection 수, fan-out, backpressure 문제가 생길 수 있다.

이 프로젝트에서도 [src/hooks/useRealtime.ts](../../src/hooks/useRealtime.ts)에
재연결과 sleep/reconnect notice 로직이 있고,
[worker/src/realtime/chat-room.ts](../../worker/src/realtime/chat-room.ts)에는
권한 변경과 live presence 처리 로직이 따로 있다. 이것이 실시간 구조의 비용이다.

### Q. Cloudflare Worker는 정확히 무엇이고, 어디서 시작했나

여기서 `Worker`는 일반적인 백그라운드 작업자가 아니라 `Cloudflare Worker`를
뜻한다. 이것은 Cloudflare의 엣지 네트워크에서 실행되는 서버 코드다.

즉:

- 브라우저 코드도 아니고
- 전통적인 장기 실행 서버 프로세스도 아니고
- Cloudflare edge에서 요청 시 실행되는 서버 런타임

이다.

배경은 `serverless`와 `edge computing`의 발전이다. 원래 웹은 중앙 서버나 특정
리전 서버에서 처리하는 경우가 많았지만, 인증, 프록시, 캐시, 경량 API를 사용자에
더 가까운 위치에서 처리하고 싶어졌고, Cloudflare는 CDN/reverse proxy 기반 위에
직접 코드 실행 모델을 올렸다.

이 프로젝트에서 Worker는 사실상 핵심 백엔드다. 구체적으로:

- API 처리
- 권한 재검증
- D1 읽기/쓰기
- R2 업로드/미디어 처리
- WebSocket 진입
- Durable Object 연결
- Cache API 기반 preview/cache 처리

를 담당한다.

즉:

- `Next.js`는 웹 애플리케이션 계층
- `Worker`는 실시간 채팅 백엔드 계층

으로 이해하면 된다.

### Q. `X-Internal-Token`, `X-User-Id`, `X-Room-Token`, `X-Anonymous-Token`, `X-Channel-Read-Token`은 각각 무엇인가

이 헤더들은 전부 "로그인 토큰"이 아니다. 서로 다른 종류의 신뢰를 나눠 담고 있다.

- `X-Internal-Token`
  Next.js 서버가 Worker에 보내는 내부 신뢰 증명이다.
- `X-User-Id`
  Next.js가 서버 세션을 확인한 뒤 "이 요청의 로그인 사용자는 이 사람"이라고
  주장하는 값이다.
- `X-Room-Token`
  passcode가 걸린 채널에 들어갈 권한을 이미 통과했다는 증명이다.
- `X-Anonymous-Token`
  익명 방문자를 안정적으로 식별하기 위한 서명된 identity다.
- `X-Channel-Read-Token`
  최근에 통과한 채널 읽기 권한을 짧은 시간 동안 재사용하게 해 주는 capability다.

즉 이 구조는:

- 서버가 주장하는 로그인 사용자 신원
- 채널 접근 권한
- 익명 방문자 identity
- 짧은 read capability

를 서로 다른 토큰으로 분리한다.

### Q. 왜 `X-User-Id`만으로는 절대 충분하지 않나

`X-User-Id`는 문자열일 뿐이다. 브라우저는 임의의 헤더를 붙일 수 있으므로,
그 값 하나만 보고 owner/admin으로 취급하면 안 된다.

그래서 Worker는:

- `X-Internal-Token === env.INTERNAL_SECRET`

인지 먼저 확인하고, 그게 맞을 때만 `X-User-Id`를 신뢰한다.

관련 코드는
[worker/src/lib/trusted-identity.ts](../../worker/src/lib/trusted-identity.ts)다.

즉:

- `X-User-Id` = 주장
- `X-Internal-Token` = 그 주장을 믿어도 되는 근거

라고 보면 된다.

### Q. `X-Internal-Token`과 `X-User-Id`는 실제로 어디서 붙나

Next.js 프록시가 Auth.js 세션을 확인한 뒤, 로그인된 사용자가 있으면 둘을 같이
붙인다.

관련 코드는:

- [src/app/api/data/route.ts](../../src/app/api/data/route.ts)
- [src/app/api/unified-timeline/route.ts](../../src/app/api/unified-timeline/route.ts)

즉 브라우저가 직접 Worker에 로그인 사용자 ID를 증명하는 것이 아니라,
`Next.js 서버가 세션을 확인한 뒤 대신 Worker에 전달`하는 구조다.

### Q. `X-Room-Token`은 정확히 무엇을 증명하나

`X-Room-Token`은 "이 사용자가 이 잠긴 채널의 passcode gate를 통과했다"는 증명이다.
로그인 증명도 아니고 owner 증명도 아니다.

Worker는 passcode를 성공적으로 검증한 뒤 `room-access` 토큰을 발급한다. 이 토큰은:

- `channel_id`
- `passcode_binding`
- `iat`
- `exp`

를 담는다.

여기서 중요한 것은 `passcode_binding`이다. 이 값은 단순한 채널 ID가 아니라
`현재 저장된 passcode hash`와 채널 ID를 다시 HMAC으로 묶은 값이다.

관련 코드는
[worker/src/routes/passcode.ts](../../worker/src/routes/passcode.ts)에 있다.

### Q. `X-Room-Token`은 어떻게 검증되나

검증은 두 단계다.

1. `verifyRoomToken()`
   HMAC 서명, 형식, 만료 시간을 검증한다.
2. `authorizeRoomToken()`
   `channel_id`가 현재 채널과 맞는지 보고, `passcode_binding`이 현재 채널의
   최신 passcode hash와 아직도 맞는지 다시 확인한다.

관련 코드는:

- [worker/src/routes/passcode.ts](../../worker/src/routes/passcode.ts)

이 설계 덕분에 채널 passcode가 바뀌면 예전 room token은 자동으로 무효가 된다.
즉 "예전에 한 번 통과했다"가 아니라 "지금도 유효한 passcode 상태에 묶여 있다"가
핵심이다.

### Q. `X-Anonymous-Token`은 왜 필요한가

익명 사용자도 완전 무상태로 다루면 서비스가 깨진다. 예를 들어:

- 본인이 보낸 DM 루트를 다시 찾아야 하고
- 차단 여부를 확인해야 하고
- 같은 익명 방문자에게 짧은 read capability를 다시 묶어야 하고
- 업로드/행동 제한을 어느 정도 같은 주체에 연결해야 한다

그래서 Worker는 익명 사용자에게 `anonymous-identity` 토큰을 발급한다.

이 토큰은 대략:

- `type: "anonymous-identity"`
- `uid`
- `iat`
- `exp`

를 담고, HMAC으로 서명된다.

관련 코드는
[worker/src/lib/anonymous-identity.ts](../../worker/src/lib/anonymous-identity.ts)다.

중요한 점은 이 토큰이 `채널 접근 자체를 허용하는 것은 아니라는 것`이다. 이것은
"이 익명 방문자가 누구인지 안정적으로 식별하는 수단"이다.

### Q. `X-Channel-Read-Token`은 왜 따로 필요한가

이 토큰은 로그인 토큰도 아니고 room token도 아니다. 역할은:

"최근에 통과한 채널 read access를 아주 짧은 시간 동안 재사용해서, 같은 종류의
읽기 요청마다 매번 처음부터 권한 판정을 반복하지 않게 해 주는 것"

이다.

이 토큰은:

- `type: "channel-read"`
- `version`
- `channel_id`
- `viewer`
- `subject`
- `iat`
- `exp`

를 담는다.

버전 1은 채널 snapshot까지 포함하고, 버전 2는 access-only capability다.

관련 코드는
[worker/src/lib/channel-read-token.ts](../../worker/src/lib/channel-read-token.ts)다.

### Q. `X-Channel-Read-Token`은 어떻게 검증되나

이 토큰은 서명만 맞는다고 끝나지 않는다. Worker는:

1. HMAC 서명 검증
2. 타입/버전/만료 검증
3. `channel_id` 일치 검증
4. 현재 요청 주체와 `subject` 재결합 검증

을 한다.

마지막 단계가 가장 중요하다.

- `viewer === "owner"`이면
  `getTrustedUserId(request, env) === payload.subject` 여야 한다.
- `viewer === "visitor"`이면
  현재의 `X-Anonymous-Token`을 검증한 결과 `uid === payload.subject` 여야 한다.

즉 channel-read token 문자열만 갖고 있어서는 안 되고, 현재의 로그인 사용자나
현재의 익명 identity와 다시 맞아야 한다.

관련 코드는
[worker/src/lib/channel-read-token.ts](../../worker/src/lib/channel-read-token.ts)다.

### Q. Worker는 실제 요청에서 이 토큰들을 어떤 순서로 보나

예를 들어 `/api/data`와 `/api/unified-timeline`은 대략 이런 순서로 움직인다.

1. 허용된 read 타입이면 `X-Channel-Read-Token`을 먼저 검증 시도한다.
2. 실패하거나 없으면 채널의 실제 passcode/owner 상태를 D1에서 읽는다.
3. `X-Internal-Token + X-User-Id`가 맞으면 trusted user로 취급한다.
4. owner가 아니고 passcode가 있으면 `X-Room-Token`을 검증한다.
5. visitor 경로에서는 `X-Anonymous-Token`으로 익명 사용자를 식별한다.
6. 성공한 read-only 경로는 새 `X-Channel-Read-Token`을 다시 발급할 수 있다.

관련 코드는:

- [worker/src/routes/data.ts](../../worker/src/routes/data.ts)
- [worker/src/routes/unified-timeline.ts](../../worker/src/routes/unified-timeline.ts)

즉 구조는:

- 빠른 capability 경로
- authoritative fallback 경로

의 이중 구조다.

### Q. `/api/init`은 이 토큰들을 어떻게 발급하나

`/api/init`은 채널 진입 bootstrap 시점에 여러 토큰을 정리한다.

- 익명 토큰이 없으면 새 `anonymous-identity` 발급
- device 토큰이 없으면 새 `device-identity` 발급
- owner가 passcode 채널에 들어오면 owner용 room token 발급 가능
- 적절한 경우 channel-read capability 발급

관련 코드는
[worker/src/routes/init.ts](../../worker/src/routes/init.ts)에 있다.

그리고 Next.js는 여기서 내려온 `X-Channel-Read-Token`을 채널별 HttpOnly cookie로
저장해 다음 read 경로에서 다시 보낼 수 있게 한다.

관련 코드는
[src/lib/channel-read-token-cookie.ts](../../src/lib/channel-read-token-cookie.ts)다.

### Q. 이 구조의 가장 중요한 보안 원칙은 무엇인가

이 시스템은 `어떤 토큰도 단독으로 과신하지 않는다`는 원칙 위에 서 있다.

예를 들면:

- `X-User-Id`만으로 owner 취급하지 않는다.
- `X-Channel-Read-Token`만으로 현재 주체를 확정하지 않는다.
- `X-Room-Token`도 현재 passcode hash와 다시 묶는다.
- `X-Anonymous-Token`은 identity일 뿐, access 자체를 주지는 않는다.

즉 이 구조는 단순 "서명 검증"이 아니라:

- 누가 주장했는가
- 현재 채널과 맞는가
- 현재 passcode 상태와 맞는가
- 현재 요청 주체와 다시 이어지는가

를 매번 대조한다.

이게 이 프로젝트 권한 모델의 핵심이다.

### Q. 토큰은 어느 단계에서 쓰이고, 어디서 생성되고, 어디서 검증되나

이 프로젝트는 "토큰 하나로 모든 것을 해결"하는 구조가 아니다. 단계별로 다른
토큰을 쓴다. 아래 표로 보면 전체 흐름이 한 번에 잡힌다.

| 토큰/신호 | 언제 쓰나 | 어디서 생성되나 | 어디에 저장/전달되나 | 어디서 검증되나 |
| --- | --- | --- | --- | --- |
| `Auth.js session` | 로그인된 사용자가 Next.js 페이지/API를 칠 때 | Auth.js 로그인 흐름 | 브라우저와 Next.js 사이 세션 쿠키 | Next.js `auth()` 호출 ([src/app/api/init/route.ts](../../src/app/api/init/route.ts), [src/app/api/data/route.ts](../../src/app/api/data/route.ts)) |
| `X-Internal-Token` | Next.js가 Worker에 "내부 서버 요청"임을 주장할 때 | 별도 발급이 아니라 `INTERNAL_SECRET` 환경변수 사용 | Next.js가 Worker 요청 헤더에 첨부 | Worker의 [worker/src/lib/trusted-identity.ts](../../worker/src/lib/trusted-identity.ts) |
| `X-User-Id` | 로그인 사용자 ID를 Worker에 전달할 때 | Next.js가 서버 세션 확인 후 헤더에 설정 | Next.js -> Worker 헤더 | Worker의 [worker/src/lib/trusted-identity.ts](../../worker/src/lib/trusted-identity.ts), 각 route의 owner 판정 |
| `X-Anonymous-Token` | 익명 방문자를 같은 주체로 식별해야 할 때 | Worker의 [worker/src/lib/anonymous-identity.ts](../../worker/src/lib/anonymous-identity.ts), 보통 [worker/src/routes/init.ts](../../worker/src/routes/init.ts) | HttpOnly cookie, 이후 Next.js가 Worker로 전달 | `verifyAnonymousIdentityToken()` in [worker/src/lib/anonymous-identity.ts](../../worker/src/lib/anonymous-identity.ts) |
| `X-Device-Token` | 디바이스 단위 식별, 차단/남용 제어 보조가 필요할 때 | Worker의 [worker/src/lib/anonymous-identity.ts](../../worker/src/lib/anonymous-identity.ts), 보통 [worker/src/routes/init.ts](../../worker/src/routes/init.ts) | HttpOnly cookie, 이후 Next.js가 Worker로 전달 | `verifyDeviceIdentityToken()` in [worker/src/lib/anonymous-identity.ts](../../worker/src/lib/anonymous-identity.ts) |
| `X-Room-Token` | passcode 채널에 이미 입장 권한을 통과했음을 증명할 때 | Worker의 [worker/src/routes/passcode.ts](../../worker/src/routes/passcode.ts)에서 `createRoomToken()` | [src/app/api/verify-passcode/route.ts](../../src/app/api/verify-passcode/route.ts)에서 받아 HttpOnly cookie 저장 후 이후 요청 헤더로 전달 | `authorizeRoomToken()` in [worker/src/routes/passcode.ts](../../worker/src/routes/passcode.ts), `init/data/unified-timeline/messages/upload/socket-auth/chat-room` |
| `X-Channel-Read-Token` | 최근 통과한 read 권한을 짧게 재사용할 때 | Worker의 [worker/src/lib/channel-read-token.ts](../../worker/src/lib/channel-read-token.ts), 주로 [worker/src/routes/init.ts](../../worker/src/routes/init.ts), [worker/src/routes/data.ts](../../worker/src/routes/data.ts), [worker/src/routes/unified-timeline.ts](../../worker/src/routes/unified-timeline.ts) | 응답 헤더 -> Next.js가 채널별 HttpOnly cookie 저장 -> 다음 read 요청에 다시 전달 | `authorizeChannelReadToken()` in [worker/src/lib/channel-read-token.ts](../../worker/src/lib/channel-read-token.ts) |
| `WebSocket token` | 브라우저가 `/ws/:channel` 실시간 연결을 인증할 때 | Next.js의 [src/app/api/ws-token/route.ts](../../src/app/api/ws-token/route.ts), 사전 권한판정은 Worker [worker/src/routes/socket-auth.ts](../../worker/src/routes/socket-auth.ts) | 브라우저가 WS auth message에 포함해 DO로 전송 | DO의 [worker/src/realtime/chat-room.ts](../../worker/src/realtime/chat-room.ts), 검증 함수는 [worker/src/lib/admin-ws-token.ts](../../worker/src/lib/admin-ws-token.ts) |
| `media_token` | 보호된 이미지/배경 같은 미디어 URL 접근 때 | Next.js의 [src/lib/media-access-token.ts](../../src/lib/media-access-token.ts) | 서명된 미디어 URL query string | Worker의 [worker/src/routes/upload.ts](../../worker/src/routes/upload.ts)에서 `verifyMediaAccessToken()` |

실제 요청 흐름으로 다시 묶어 보면:

1. 로그인 사용자는 `Auth.js session`으로 먼저 Next.js에서 식별된다.
2. Next.js는 Worker에 갈 때 `X-Internal-Token + X-User-Id`로 내부 신뢰를 전달한다.
3. 익명 사용자는 `X-Anonymous-Token + X-Device-Token`으로 지속 식별된다.
4. 잠긴 채널에 들어가면 `X-Room-Token`이 생기고, 이후 read/write/upload/ws 준비 단계에 재사용된다.
5. read 경로는 `X-Channel-Read-Token`으로 짧게 최적화된다.
6. 실시간 연결 순간에는 별도로 `WebSocket token`을 다시 쓴다.
7. 보호 미디어는 마지막으로 `media_token`까지 붙어야 안전하게 읽을 수 있다.

### Q. 토큰은 HTTP가 만드는 것인가

아니다. `HTTP`는 토큰을 만드는 주체가 아니라, 토큰을 `전달하는 통로`다.

정확히 나누면:

- 토큰을 만드는 주체
  Next.js 서버 코드, Worker 서버 코드, 혹은 Auth.js 같은 서버 측 인증 로직
- 토큰을 실어 나르는 경로
  HTTP 헤더, HTTP 응답 본문, 쿠키, WebSocket 메시지

이 프로젝트를 기준으로 보면:

- `Auth.js session`
  Auth.js/Next.js가 만든다.
- `X-Internal-Token`
  새로 발급하는 토큰이라기보다 `INTERNAL_SECRET` 값을 Next.js가 헤더에 넣는다.
- `X-User-Id`
  Next.js가 `auth()`로 세션을 확인한 뒤 헤더에 적는다.
- `X-Anonymous-Token`, `X-Device-Token`
  Worker가 만든다.
- `X-Room-Token`
  Worker가 passcode 검증 성공 후 만든다.
- `X-Channel-Read-Token`
  Worker가 read capability로 만든다.
- `WebSocket token`
  Next.js가 만들되, 그 전에 Worker가 socket auth 판정을 한다.
- `media_token`
  Next.js가 미디어 URL에 붙이기 직전에 만든다.

즉 "토큰을 누가 만들었는가"와 "토큰이 어떤 프로토콜로 전달되는가"는 다른 질문이다.

- 생성
  애플리케이션 서버 코드가 한다.
- 전달
  HTTP나 WebSocket이 한다.

그래서 `HTTP가 토큰을 만든다`고 보면 안 되고,
`서버가 토큰을 만들고 HTTP가 그것을 옮긴다`고 이해하는 편이 정확하다.

### Q. 이 프로젝트에서 쓰는 API를 전체적으로 분류하면 어떻게 되나

이 프로젝트에서 `API`라고 부르는 것은 한 종류가 아니다. 크게 보면 다섯 층이
겹쳐서 동작한다.

1. 브라우저 Web API
2. Next.js 서버 API
3. 애플리케이션 HTTP API
4. Cloudflare 플랫폼 API
5. 인증/서명용 보안 API

중요한 점은 브라우저가 직접 모든 백엔드 자원을 두드리는 구조가 아니라는 것이다.
브라우저는 보통 `Next.js /api/*`를 먼저 치고, Next.js가 필요한 헤더와 세션 정보를
붙여 Worker로 다시 보낸다. 실제 권한 판단과 데이터 정답은 Worker 쪽에 있다.

### Q. 브라우저 쪽에서는 어떤 Web API를 쓰나

가장 기본은 `fetch`와 `WebSocket`이다.

- `fetch`
  초기화, 히스토리 조회, 메시지 전송, 업로드, 지원 요청 같은 거의 모든 HTTP 호출
  에 사용된다.
- `WebSocket`
  채팅 메시지, presence, live 상태처럼 서버가 먼저 밀어줘야 하는 실시간 이벤트에
  사용된다.
- `Request`, `Response`, `Headers`, `URL`
  Next.js Route Handler와 Worker가 모두 웹 표준 인터페이스를 쓰기 때문에, 서버
  코드도 브라우저와 비슷한 모델로 움직인다.
- `Cache API`
  브라우저 쪽에서는 preview/background 같은 일부 데이터를 임시 복원하는 데
  쓰이고, Worker 쪽에서는 edge 캐시 용도로 따로 쓰인다. 이름은 같지만 계층은
  다르다.
- `crypto.subtle`
  이 프로젝트에서는 특히 토큰 서명/검증에 쓰인다. 브라우저 전용이 아니라
  Next.js/Worker 런타임에서도 같은 계열 API를 쓴다.

즉 이 프로젝트는 오래된 Node 전용 API보다 `웹 표준 API` 위에 많이 서 있다.

### Q. Next.js 서버 API는 무엇을 하나

Next.js는 단순 페이지 렌더러가 아니라 `브라우저와 Worker 사이의 첫 번째 서버
경계`다.

코드상으로는 [src/app/api](../../src/app/api) 아래 Route Handler들이 그 역할을
한다.

예를 들면:

- [src/app/api/init/route.ts](../../src/app/api/init/route.ts)
  채널 진입 bootstrap 요청을 Worker로 프록시하고, 익명 토큰/room token/channel
  read token 쿠키를 정리한다.
- [src/app/api/data/route.ts](../../src/app/api/data/route.ts)
  채널 데이터 read 요청을 Worker로 보내고, 응답 안의 보호 미디어 URL을 다시
  서명한다.
- [src/app/api/unified-timeline/route.ts](../../src/app/api/unified-timeline/route.ts)
  공개 메시지, DM root, owner reply를 한 타임라인으로 합친 읽기 경로를 프록시한다.
- [src/app/api/messages/route.ts](../../src/app/api/messages/route.ts)
  메시지 전송/수정/삭제/리액션 요청을 Worker로 전달한다.
- [src/app/api/upload/route.ts](../../src/app/api/upload/route.ts)
  업로드 바이트 스트림을 Worker로 전달하면서 필요한 권한 헤더를 붙인다.
- [src/app/api/ws-token/route.ts](../../src/app/api/ws-token/route.ts)
  WebSocket 연결 전에 사용할 짧은 수명의 WS 토큰을 발급한다.

여기서 Next.js가 하는 핵심 일은:

- Auth.js 세션 확인
- HttpOnly cookie 읽기/쓰기
- 내부 요청 헤더 부착
- Worker 응답을 브라우저 친화적으로 가공

이다.

### Q. 브라우저가 실제로 치는 애플리케이션 HTTP API는 무엇들인가

브라우저 관점에서는 주로 `Next.js /api/*`가 공개 API다. 이 프로젝트에서 자주
보이는 것들을 목적별로 묶으면 아래와 같다.

- 진입/읽기
  `/api/init`, `/api/data`, `/api/unified-timeline`, `/api/channel-state`,
  `/api/recent-channels`
- 쓰기/실시간 준비
  `/api/messages`, `/api/dm`, `/api/upload`, `/api/ws-token`,
  `/api/verify-passcode`, `/api/room-token`
- 사용자/운영
  `/api/user`, `/api/admin`, `/api/support`, `/api/platform-admin/support`,
  `/api/channel-reports`, `/api/global-notice`, `/api/survey`,
  `/api/notifications/*`, `/api/version`
- 인증
  `/api/auth/[...nextauth]`, `/api/email-auth`

이 중에서 정말 구조를 이해하는 데 중요한 최소 집합은:

1. `/api/init`
2. `/api/data` 또는 `/api/unified-timeline`
3. `/api/messages`
4. `/api/upload`
5. `/api/ws-token`

이다. 이 다섯 개를 이해하면 채널 진입부터 읽기, 쓰기, 실시간 연결까지 거의 다
보인다.

### Q. Worker 쪽 API는 왜 따로 있나

Worker에는 이 프로젝트의 `authoritative API`가 있다. 실제 권한 검사, D1 조회,
R2 업로드, DO 연결, preview 생성 같은 핵심 로직은 여기서 수행된다.

라우팅은 [worker/src/index.ts](../../worker/src/index.ts)에 모여 있다.

대표적으로:

- `/api/init`
- `/api/data`
- `/api/unified-timeline`
- `/api/messages`
- `/api/dm`
- `/api/upload`
- `/api/socket-auth`
- `/api/verify-passcode`
- `/api/support`
- `/api/media/:key`
- `/ws/:channel`

가 있다.

여기서 중요한 차이는:

- `Next.js /api/*` = 브라우저-facing 경계
- `Worker /api/*` = 권한과 데이터의 실제 정답

이라는 점이다.

이름이 비슷해도 역할은 다르다. 예를 들어
[src/app/api/data/route.ts](../../src/app/api/data/route.ts)는 프록시이고,
[worker/src/routes/data.ts](../../worker/src/routes/data.ts)는 실제 읽기 정책을
집행한다.

### Q. Cloudflare 플랫폼 API는 구체적으로 무엇을 쓰나

이 프로젝트의 Worker 내부에서는 Cloudflare 전용 API가 많이 쓰인다.

- Worker `fetch` handler
  모든 HTTP 요청의 진입점이다.
- Durable Objects
  채널별 실시간 연결과 broadcast를 맡는다.
- D1 API
  `env.DB.prepare(...).bind(...).first()/run()/all()` 같은 형태로 관계형 데이터를
  읽고 쓴다.
- R2 API
  업로드 파일 원본을 저장하고 꺼낸다.
- Cache API
  preview나 공개 배경 메타데이터처럼 짧게 재사용할 데이터를 edge에서 캐시한다.
- Scheduled handler
  알림 outbox 배달, 유지보수, 운영 경고 평가 같은 주기 작업에 쓰인다.

즉 Worker는 단순 HTTP 서버가 아니라 `Cloudflare 플랫폼 기능들을 묶는 오케스트라`
에 가깝다.

### Q. Durable Object API는 이 프로젝트에서 어떻게 쓰이나

이 프로젝트는 DO를 거의 `채널별 실시간 actor`처럼 쓴다.

예를 들면 [worker/src/index.ts](../../worker/src/index.ts)에서 WebSocket 요청이
`/ws/:channel`로 들어오면:

1. `env.CHAT_ROOM.idFromName(channelId)`로 DO ID를 만든다.
2. `env.CHAT_ROOM.get(doId)`로 스텁을 얻는다.
3. `stub.fetch(request)`로 해당 채널 인스턴스에 연결을 넘긴다.

또 메시지 저장 후에는
[worker/src/routes/messages.ts](../../worker/src/routes/messages.ts)에서 같은 DO에
`/broadcast` 요청을 보내 실시간 fan-out을 한다.

즉 DO API는:

- WebSocket 연결 수용
- 채널별 직렬화
- broadcast 조정
- live presence 관리

에 쓰인다.

### Q. 보안 쪽 API는 무엇이 핵심인가

이 프로젝트는 보안도 API처럼 봐야 이해가 쉽다. 대표적인 것은 두 갈래다.

- Auth.js 세션 API
  Next.js가 `auth()`로 로그인 사용자를 확인한다.
- Web Crypto API
  `crypto.subtle`로 HMAC 서명과 검증을 한다.

예를 들면:

- [src/app/api/ws-token/route.ts](../../src/app/api/ws-token/route.ts)
  에서는 WS 토큰을 HMAC으로 서명한다.
- [worker/src/routes/upload.ts](../../worker/src/routes/upload.ts)
  에서는 미디어 접근 토큰을 검증한다.

이 덕분에 이 프로젝트는 단순 쿠키 문자열 비교가 아니라, `서명된 capability`와
`내부 서버 신뢰`를 조합해서 권한을 판단한다.

### Q. 결국 이 프로젝트 API의 실제 요청 흐름은 어떻게 보나

대표 흐름 몇 개만 잡아두면 전체가 정리된다.

1. 채널 진입
   브라우저 -> `/api/init` -> Worker `/api/init` -> D1 조회 -> 토큰/쿠키 정리
2. 히스토리 읽기
   브라우저 -> `/api/data` 또는 `/api/unified-timeline` -> Worker read 정책 집행
   -> D1 조회 -> 필요 시 channel read token 갱신
3. 메시지 전송
   브라우저 -> `/api/messages` -> Worker 검증/저장 -> D1 write -> DO broadcast
4. 이미지 업로드
   브라우저 -> `/api/upload` -> Worker 권한/쿼터 검사 -> R2 저장 -> upload ticket 기록
5. 실시간 연결
   브라우저 -> `/api/ws-token` -> Worker `/api/socket-auth` -> WS 토큰 발급 ->
   `/ws/:channel` WebSocket 연결 -> ChatRoom DO 수용

이 다섯 흐름을 보면, 이 프로젝트의 API는 사실상 `페이지용 API`, `권한용 API`,
`데이터용 API`, `실시간 API`, `스토리지 API`가 겹친 복합 구조라는 것을 알 수
있다.

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
