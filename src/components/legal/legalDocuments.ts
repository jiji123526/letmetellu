export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocumentContent {
  intro: string;
  effectiveDate: string;
  lastUpdated: string;
  sections: LegalSection[];
}

const privacyKo: LegalDocumentContent = {
  intro:
    "본 방침은 개인이 운영하는 yap. 서비스에서 실제로 처리하는 정보와 현재 제공 중인 기능을 기준으로 작성되었습니다.",
  effectiveDate: "2025년 5월 1일",
  lastUpdated: "2026년 7월 31일",
  sections: [
    {
      heading: "제1조(목적)",
      paragraphs: [
        "이 개인정보처리방침은 yap.(이하 \"서비스\")를 개인 프로젝트 형태로 운영하는 양소연(이하 \"운영자\")이 서비스 이용자의 개인정보를 어떻게 수집, 이용, 보관, 제공 및 파기하는지 설명하기 위하여 마련되었습니다.",
        "운영자는 개인정보보호법, 정보통신망 이용촉진 및 정보보호 등에 관한 법률 등 관련 법령을 준수하며, 이용자의 개인정보와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 노력합니다.",
      ],
    },
    {
      heading: "제2조(개인정보 처리의 원칙)",
      paragraphs: [
        "운영자는 관련 법령 및 본 방침에 따라 개인정보를 적법하고 공정하게 처리합니다.",
        "운영자는 서비스 제공에 필요한 범위 내에서만 개인정보를 수집·이용하며, 법령상 근거가 있거나 이용자의 동의가 있는 경우를 제외하고는 목적 외로 처리하지 않습니다.",
      ],
    },
    {
      heading: "제3조(본 방침의 공개)",
      paragraphs: [
        "운영자는 이용자가 언제든지 쉽게 확인할 수 있도록 본 방침을 서비스 내 법적 고지 페이지에 게시합니다.",
      ],
    },
    {
      heading: "제4조(본 방침의 변경)",
      bullets: [
        "본 방침은 관련 법령, 서비스 구조, 운영 정책 또는 기능 변경에 따라 수정될 수 있습니다.",
        "중대한 변경이 있는 경우 시행일 이전에 서비스 화면 또는 그에 준하는 방법으로 안내합니다.",
        "일반적인 문구 정리나 오탈자 수정 등 이용자 권리에 중대한 영향을 주지 않는 변경은 업데이트 일자만 갱신할 수 있습니다.",
      ],
    },
    {
      heading: "제5조(회원 가입을 위하여 수집하는 정보)",
      bullets: [
        "필수 수집 정보: 이메일 주소, 비밀번호, 닉네임",
        "소셜 로그인 이용 시: Google 계정의 기본 식별 정보 및 인증 처리에 필요한 정보",
      ],
    },
    {
      heading: "제6조(본인 확인 및 계정 보안을 위하여 처리하는 정보)",
      bullets: [
        "이메일 인증 또는 비밀번호 재설정 처리 시 이메일 주소와 인증용 토큰 또는 일회성 링크 정보",
        "로그인 보호, 비정상 접근 차단 및 계정 복구 대응을 위한 접속 기록과 보안 로그",
      ],
    },
    {
      heading: "제7조(서비스 제공 과정에서 수집 또는 생성되는 정보)",
      bullets: [
        "채널, 메시지, 답글, 반응, 신고, DM, 라이브 세션, 1:1 지원 문의 등 서비스 이용 과정에서 이용자가 입력하는 정보",
        "IP 주소, 접속 일시, 브라우저 및 기기 정보, 쿠키, 로컬 저장소 기반 환경설정, 서비스 이용 기록",
        "익명 이용 식별을 위한 서버 발급 익명 토큰, 기기 토큰, 최근 채널 및 지원 세션 상태 정보",
        "신고 처리, 차단, 동결, 운영 경고, 지원 티켓 처리에 필요한 운영 기록과 감사 로그",
      ],
    },
    {
      heading: "제8조(서비스 이용 통계 및 부정 이용 확인을 위한 정보)",
      paragraphs: [
        "운영자는 스팸, 어뷰징, 반복 신고, 차단 우회, 비정상적 대량 요청, 무단 자동화 접근, 서비스 장애 유발 행위 등을 탐지하고 대응하기 위하여 IP 기반 식별값, 요청 기록, 제한 이력, 운영 감사 기록 등을 처리할 수 있습니다.",
      ],
    },
    {
      heading: "제9조(개인정보 수집 방법)",
      bullets: [
        "이용자가 회원가입, 로그인, 채널 참여, 채팅, 신고, 지원 문의, 설정 변경 과정에서 직접 입력하는 방식",
        "브라우저, 기기 또는 네트워크 환경에서 서비스 이용 중 자동으로 생성되는 정보를 수집하는 방식",
        "이메일 인증, 비밀번호 재설정, 계정 보호 절차 등 운영자가 제공하는 보조 절차를 통해 수집하는 방식",
      ],
    },
    {
      heading: "제10조(개인정보의 이용 목적)",
      bullets: [
        "회원 식별, 로그인 처리, 계정 유지, 본인 확인 및 계정 보안 유지",
        "채널 생성 및 참여, 메시지 송수신, 신고 접수, DM, 라이브 세션, 지원 기능 제공",
        "익명 참여 상태 유지, 대시보드 최근 항목 복원, 언어 및 UI 환경설정 유지",
        "서비스 안정성 확보, 장애 대응, 보안 분석, 악용 방지, 제한 조치 및 분쟁 대응",
        "이용 문의 회신, 불만 처리, 운영 공지 전달, 기능 품질 개선 및 이용 통계 분석",
      ],
    },
    {
      heading: "제11조(개인정보의 제3자 제공)",
      paragraphs: [
        "운영자는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다. 다만 다음 각 호의 경우에는 예외로 합니다.",
      ],
      bullets: [
        "이용자가 사전에 동의한 경우",
        "Google 로그인 사용 시 인증 제공을 위하여 필요한 범위에서 Google과 연동되는 경우",
        "법령에 따라 제출 의무가 있거나 수사기관 등 관계 기관의 적법한 요청이 있는 경우",
      ],
    },
    {
      heading: "제12조(개인정보 처리 위탁 및 외부 서비스 이용)",
      bullets: [
        "운영자는 서비스 호스팅, 데이터 저장, 파일 저장, 이메일 발송, 인증, 보안 및 성능 제공을 위하여 외부 인프라 또는 플랫폼 사업자를 이용할 수 있습니다.",
        "현재 서비스 구조상 Next.js, Cloudflare, Vercel, 인증 제공자 및 이메일 발송 수단 등 외부 기술 서비스가 사용될 수 있습니다.",
        "운영자는 외부 서비스를 이용하는 경우에도 관련 법령에 따라 필요한 보호조치를 취합니다.",
      ],
    },
    {
      heading: "제13조(개인정보의 보유 및 이용기간)",
      bullets: [
        "운영자는 개인정보 수집 및 이용 목적이 달성될 때까지 개인정보를 보유·이용합니다.",
        "회원 탈퇴, 계정 삭제 또는 처리 목적 종료 후에도 법령 준수, 분쟁 대응, 보안 분석, 부정 이용 방지에 필요한 정보는 일정 기간 보관될 수 있습니다.",
        "지원 티켓, 신고 처리, 운영 감사 기록은 후속 검토 및 운영 보안 목적상 합리적인 기간 동안 보관될 수 있습니다.",
        "서비스 악용 방지용 식별 기록은 내부 기준에 따라 최대 1년 범위 내에서 보관될 수 있습니다.",
      ],
    },
    {
      heading: "제14조(법령에 따른 개인정보 보유기간)",
      bullets: [
        "통신비밀보호법에 따른 웹사이트 접속 로그 자료: 3개월",
        "전자상거래 등에서의 소비자보호에 관한 법률상 소비자 불만 또는 분쟁 처리 기록: 3년",
        "기타 관계 법령이 별도의 보관기간을 정하는 경우 그 기간",
      ],
      paragraphs: [
        "현재 서비스는 별도의 유료 결제 기능을 운영하지 않으므로 결제 관련 법정 보관 항목은 실제 도입 시점부터 해당 정책과 함께 적용됩니다.",
      ],
    },
    {
      heading: "제15조(개인정보 파기의 원칙)",
      paragraphs: [
        "운영자는 개인정보의 보유기간이 경과하거나 처리 목적이 달성된 경우 지체 없이 해당 개인정보를 파기합니다. 다만, 법령에 따라 계속 보관해야 하는 정보는 별도로 분리하여 보관합니다.",
      ],
    },
    {
      heading: "제16조(개인정보 파기 절차)",
      bullets: [
        "서비스 이용 과정에서 수집된 정보는 목적 달성 후 내부 보관 기준 또는 관계 법령에 따른 기간 동안 분리 보관된 뒤 파기됩니다.",
        "파기 대상 정보는 운영자가 확인한 후 복구 또는 재이용이 어렵도록 조치합니다.",
      ],
    },
    {
      heading: "제17조(개인정보 파기 방법)",
      bullets: [
        "전자적 파일 형태의 정보는 복구 또는 재생이 어렵도록 삭제합니다.",
        "종이 문서가 있는 경우 분쇄 또는 소각 등의 방법으로 파기합니다.",
      ],
    },
    {
      heading: "제18조(광고성 정보의 전송)",
      paragraphs: [
        "운영자는 현재 별도의 광고성 정보 발송 시스템을 상시 운영하지 않습니다.",
        "향후 이메일 등 전자적 전송매체를 이용한 광고성 정보 발송이 필요한 경우 관련 법령에 따라 사전 동의를 받거나 법령이 허용하는 범위 내에서만 발송합니다.",
      ],
    },
    {
      heading: "제19조(개인정보의 열람, 정정, 삭제 및 동의 철회)",
      bullets: [
        "이용자는 언제든지 자신의 개인정보 열람, 정정, 삭제 또는 처리정지를 요청할 수 있습니다.",
        "이용자는 계정 설정, 서비스 내 지원 경로 또는 운영자 이메일을 통하여 개인정보 관련 요청을 할 수 있습니다.",
        "운영자는 관련 법령에 따라 지체 없이 요청 내용을 검토하고 처리합니다.",
      ],
    },
    {
      heading: "제20조(개인정보 정보변경 등)",
      paragraphs: [
        "이용자는 회원정보에 변경이 있는 경우 가능한 한 즉시 계정 설정에서 수정하여야 하며, 이를 수정하지 않아 발생하는 불이익은 이용자에게 있을 수 있습니다.",
      ],
    },
    {
      heading: "제21조(이용자의 의무)",
      bullets: [
        "이용자는 자신의 개인정보를 최신 상태로 유지하여야 합니다.",
        "이용자는 타인의 개인정보를 도용하거나 허위 정보를 입력하여서는 안 됩니다.",
        "이용자는 이메일 주소, 비밀번호, 로그인 수단 등 자신의 인증 정보를 스스로 안전하게 관리하여야 합니다.",
      ],
    },
    {
      heading: "제22조(개인정보 유출 등에 대한 조치)",
      bullets: [
        "운영자는 개인정보의 분실, 도난, 유출 또는 훼손 사실을 인지한 경우 지체 없이 필요한 대응을 하고, 법령이 요구하는 경우 관계 기관 신고 및 이용자 통지를 진행합니다.",
        "이용자 통지 시에는 유출 항목, 발생 시점, 대응 조치, 이용자가 취할 수 있는 보호 수단, 문의 경로 등을 안내합니다.",
      ],
    },
    {
      heading: "제23조(개인정보 자동 수집 장치의 설치·운영 및 거부)",
      paragraphs: [
        "운영자는 로그인 유지, 언어 설정 저장, 최근 채널 복원, 익명 세션 유지, 접근 제어 및 서비스 상태 보존을 위하여 쿠키 또는 유사한 저장 기술을 사용할 수 있습니다.",
        "이용자는 브라우저 설정을 통해 쿠키 저장을 허용하거나 거부할 수 있습니다. 다만 쿠키 저장을 거부하는 경우 로그인 유지, 익명 세션 유지 또는 일부 상태 기반 기능 이용이 제한될 수 있습니다.",
      ],
    },
    {
      heading: "제24조(쿠키 설정 방법)",
      bullets: [
        "Edge: 설정 > 쿠키 및 사이트 권한 > 쿠키 및 사이트 데이터 관리 및 삭제",
        "Chrome: 설정 > 개인정보 및 보안 > 쿠키 및 기타 사이트 데이터",
        "Whale: 설정 > 개인정보 보호 > 쿠키 및 기타 사이트 데이터",
        "Safari 등 기타 브라우저: 각 브라우저의 개인정보 또는 쿠키 설정 메뉴 참조",
      ],
    },
    {
      heading: "제25조(개인정보 보호 책임자)",
      paragraphs: [
        "성명: 양소연",
        "구분: 서비스 운영자",
        "이메일: yang82soyeon@gmail.com",
      ],
    },
    {
      heading: "제26조(권익침해에 대한 구제방법)",
      bullets: [
        "개인정보분쟁조정위원회: 1833-6972 / www.kopico.go.kr",
        "개인정보침해신고센터: 118 / privacy.kisa.or.kr",
        "대검찰청: 1301 / www.spo.go.kr",
        "경찰청: 182 / ecrm.cyber.go.kr",
        "중앙행정심판위원회: 110 / www.simpan.go.kr",
      ],
      paragraphs: [
        "운영자는 이용자의 개인정보자기결정권을 보장하기 위하여 노력하며, 개인정보 관련 상담이나 신고가 필요한 경우 제25조의 연락처로 문의할 수 있습니다.",
      ],
    },
    {
      heading: "부칙",
      paragraphs: [
        "본 방침은 2025년 5월 1일부터 시행합니다.",
      ],
    },
  ],
};

const privacyEn: LegalDocumentContent = {
  intro:
    "This Policy is written to match the information flows and features that yap. currently operates as a personally managed project.",
  effectiveDate: "May 1, 2025",
  lastUpdated: "July 31, 2026",
  sections: [
    {
      heading: "Article 1 (Purpose)",
      paragraphs: [
        "This Privacy Policy explains how Yang Soyeon, the individual operator of yap. (the \"Service\" and the \"Operator\"), collects, uses, stores, discloses, and deletes personal information of Service users.",
        "The Operator complies with applicable privacy and network information laws and seeks to handle user privacy concerns promptly and appropriately.",
      ],
    },
    {
      heading: "Article 2 (Principles of Processing)",
      paragraphs: [
        "The Operator processes personal information lawfully and fairly in accordance with applicable law and this Policy.",
        "Personal information is collected and used only to the extent necessary for Service operation, unless a broader basis is permitted by law or supported by the user's consent.",
      ],
    },
    {
      heading: "Article 3 (Publication of This Policy)",
      paragraphs: [
        "This Policy is posted through the Service's legal notice pages so users can review it at any time.",
      ],
    },
    {
      heading: "Article 4 (Changes to This Policy)",
      bullets: [
        "This Policy may be updated when laws, Service structure, operational practices, or features change.",
        "Material changes will be announced before the effective date through the Service or another reasonable notice method.",
        "Editorial cleanups or changes that do not materially affect user rights may be reflected by updating the last-updated date only.",
      ],
    },
    {
      heading: "Article 5 (Information Collected for Registration)",
      bullets: [
        "Required information: email address, password, and nickname",
        "When social sign-in is used: basic Google account identifier and information required for authentication",
      ],
    },
    {
      heading: "Article 6 (Information Used for Identity Verification and Account Security)",
      bullets: [
        "Email address and token or one-time link data used for email verification or password reset",
        "Access records and security logs used to protect logins, block suspicious access, and respond to account recovery issues",
      ],
    },
    {
      heading: "Article 7 (Information Collected or Generated During Service Use)",
      bullets: [
        "Information users submit while using channels, messages, replies, reactions, reports, owner DMs, live sessions, or one-to-one support",
        "IP address, access time, browser and device information, cookies, locally stored preferences, and Service usage records",
        "Server-issued anonymous tokens, device tokens, and recent channel or support-session state used to preserve guest participation",
        "Operational and audit records needed for moderation, blocking, freezing, warnings, report handling, and support-ticket processing",
      ],
    },
    {
      heading: "Article 8 (Information Used for Statistics and Abuse Detection)",
      paragraphs: [
        "The Operator may process request records, rate-limit history, abuse indicators, and security logs to detect and respond to spam, repeated abuse, block evasion, excessive automated traffic, malicious activity, or behavior that disrupts the Service.",
      ],
    },
    {
      heading: "Article 9 (Methods of Collection)",
      bullets: [
        "Information entered directly by users during sign-up, login, channel participation, chat, reporting, support, or settings changes",
        "Information automatically generated from the browser, device, or network environment during Service use",
        "Information collected through supporting flows such as email verification, password reset, or account protection procedures",
      ],
    },
    {
      heading: "Article 10 (Purposes of Use)",
      bullets: [
        "User identification, authentication, account maintenance, and account security",
        "Providing channels, messages, reporting, DMs, live sessions, and support features",
        "Maintaining anonymous participation state, restoring dashboard recents, and preserving language and UI preferences",
        "Ensuring Service reliability, responding to incidents, analyzing security issues, preventing abuse, enforcing restrictions, and handling disputes",
        "Replying to inquiries, handling complaints, delivering operational notices, and improving Service quality through usage analysis",
      ],
    },
    {
      heading: "Article 11 (Provision to Third Parties)",
      paragraphs: [
        "As a general rule, the Operator does not disclose personal information to third parties, except in the following cases.",
      ],
      bullets: [
        "Where the user has given prior consent",
        "Where Google sign-in requires limited sharing with Google for authentication",
        "Where disclosure is required by law or by a lawful request from an authorized authority",
      ],
    },
    {
      heading: "Article 12 (Outsourcing and External Services)",
      bullets: [
        "The Operator may use external infrastructure or platform providers for hosting, storage, file handling, email delivery, authentication, security, and performance.",
        "The current Service stack may rely on providers such as Next.js hosting, Cloudflare services, Vercel deployment, authentication providers, and email-delivery tools.",
        "Reasonable safeguards are applied when using such services in accordance with applicable law.",
      ],
    },
    {
      heading: "Article 13 (Retention Period)",
      bullets: [
        "Personal information is retained only for as long as necessary to achieve the purposes described in this Policy.",
        "Even after account deletion or the end of a processing purpose, certain records may be retained where required for legal compliance, dispute response, security review, or abuse prevention.",
        "Support-ticket records, report handling history, and operational audit logs may be retained for a reasonable period for follow-up review and platform safety.",
        "Anti-abuse identifiers may be retained for up to one year under internal standards.",
      ],
    },
    {
      heading: "Article 14 (Statutory Retention Periods)",
      bullets: [
        "Website access log records under communications privacy laws: 3 months",
        "Complaint or dispute-handling records where required by consumer protection law: 3 years",
        "Any other retention period specifically required by applicable law",
      ],
      paragraphs: [
        "The Service does not currently operate a paid plan or payment feature. If payment functions are introduced later, related retention duties will apply from that point together with an updated policy or separate notice.",
      ],
    },
    {
      heading: "Article 15 (Principle of Deletion)",
      paragraphs: [
        "Personal information is deleted without undue delay once the retention period expires or the processing purpose has been fulfilled, unless continued retention is required by law.",
      ],
    },
    {
      heading: "Article 16 (Deletion Procedure)",
      bullets: [
        "Collected information is separated and retained for the applicable internal or legal retention period, then deleted when no longer needed.",
        "Deletion targets are reviewed by the Operator and removed in a way that makes recovery or reuse difficult.",
      ],
    },
    {
      heading: "Article 17 (Deletion Method)",
      bullets: [
        "Electronic records are deleted using methods that make restoration difficult.",
        "Paper documents, if any, are destroyed by shredding, incineration, or similar means.",
      ],
    },
    {
      heading: "Article 18 (Promotional Messages)",
      paragraphs: [
        "The Operator does not currently run a standing promotional messaging program.",
        "If marketing emails or similar electronic promotional messages are introduced later, they will be sent only with the consent or legal basis required by applicable law.",
      ],
    },
    {
      heading: "Article 19 (Access, Correction, Deletion, and Withdrawal of Consent)",
      bullets: [
        "Users may request access to, correction of, deletion of, or restriction of processing of their personal information.",
        "Requests may be submitted through account settings, the in-Service support path, or the Operator's contact email.",
        "The Operator will review and handle such requests without undue delay in accordance with applicable law.",
      ],
    },
    {
      heading: "Article 20 (Updating Personal Information)",
      paragraphs: [
        "Users should update their account information promptly when it changes. Failure to do so may result in disadvantages for which the user is responsible.",
      ],
    },
    {
      heading: "Article 21 (User Responsibilities)",
      bullets: [
        "Users must keep their personal information accurate and current.",
        "Users must not sign up using another person's information or false information.",
        "Users are responsible for protecting their own email address, password, and other authentication credentials.",
      ],
    },
    {
      heading: "Article 22 (Response to Data Incidents)",
      bullets: [
        "If the Operator becomes aware of loss, theft, leakage, or damage involving personal information, the Operator will respond without undue delay and make any reports or notices required by law.",
        "Where notice is required, users will be informed of the affected information, timing, response measures, available protective steps, and contact channels.",
      ],
    },
    {
      heading: "Article 23 (Cookies and Similar Technologies)",
      paragraphs: [
        "The Operator may use cookies or similar storage technologies to keep users signed in, save language settings, restore recent channels, preserve guest sessions, enforce access controls, and maintain Service state.",
        "Users may allow or block cookies through browser settings. Blocking them may limit login persistence, guest-session continuity, or other stateful features.",
      ],
    },
    {
      heading: "Article 24 (How to Configure Cookie Settings)",
      bullets: [
        "Edge: Settings > Cookies and site permissions > Manage and delete cookies and site data",
        "Chrome: Settings > Privacy and security > Cookies and other site data",
        "Whale: Settings > Privacy > Cookies and other site data",
        "Safari or other browsers: check the browser's privacy or cookie settings menu",
      ],
    },
    {
      heading: "Article 25 (Privacy Contact)",
      paragraphs: [
        "Name: Yang Soyeon",
        "Role: Service Operator",
        "Email: yang82soyeon@gmail.com",
      ],
    },
    {
      heading: "Article 26 (Remedies for Privacy Infringement)",
      bullets: [
        "Personal Information Dispute Mediation Committee: 1833-6972 / www.kopico.go.kr",
        "Personal Information Infringement Report Center: 118 / privacy.kisa.or.kr",
        "Supreme Prosecutors' Office: 1301 / www.spo.go.kr",
        "National Police Agency: 182 / ecrm.cyber.go.kr",
        "Central Administrative Appeals Commission: 110 / www.simpan.go.kr",
      ],
      paragraphs: [
        "The Operator seeks to protect each user's right to control their own personal information. Privacy-related complaints or questions may be directed to the contact listed in Article 25.",
      ],
    },
    {
      heading: "Supplementary Provision",
      paragraphs: [
        "This Policy takes effect on May 1, 2025.",
      ],
    },
  ],
};

const termsKo: LegalDocumentContent = {
  intro:
    "아래 약관은 현재 운영 중인 yap. 서비스 구조와 기능을 기준으로 작성된 이용약관입니다.",
  effectiveDate: "2025년 5월 1일",
  lastUpdated: "2026년 7월 31일",
  sections: [
    {
      heading: "제1조(목적)",
      paragraphs: [
        "이 약관은 개인이 운영하는 yap.(이하 \"서비스\")의 이용과 관련하여 운영자 양소연(이하 \"운영자\")과 이용자 사이의 권리, 의무, 책임사항 및 서비스 이용조건을 정함을 목적으로 합니다.",
      ],
    },
    {
      heading: "제2조(정의)",
      bullets: [
        "\"이용자\"란 본 약관에 따라 서비스를 이용하는 회원 및 비회원을 말합니다.",
        "\"회원\"이란 이메일 또는 Google 로그인을 이용하여 계정을 생성하고 서비스를 이용하는 자를 말합니다.",
        "\"비회원\"이란 회원가입 없이 익명으로 채널 또는 지원 기능 등 서비스 일부를 이용하는 자를 말합니다.",
        "\"채널\"이란 이용자가 링크를 통해 입장하거나 운영하는 대화 공간을 말합니다.",
        "\"게시물\"이란 메시지, 답글, 이미지, 신고 내용, DM, 지원 문의 등 이용자가 서비스에 입력하거나 업로드하는 일체의 정보를 말합니다.",
        "\"운영자\"란 서비스 운영, 관리, 신고 처리, 지원 처리 및 정책 집행을 담당하는 개인을 말합니다.",
      ],
    },
    {
      heading: "제3조(적용 범위 및 효력)",
      bullets: [
        "본 약관은 서비스를 이용하고자 하는 모든 이용자에게 적용됩니다.",
        "서비스 내 특정 기능에 별도 안내 또는 정책이 있는 경우 그 안내 또는 정책은 본 약관과 함께 효력을 가집니다.",
        "개별 기능에 관한 특별 규정이 본 약관과 충돌하는 경우 특별 규정이 우선 적용됩니다.",
      ],
    },
    {
      heading: "제4조(약관의 게시 및 변경)",
      bullets: [
        "운영자는 본 약관을 서비스 내 법적 고지 페이지에 게시합니다.",
        "운영자는 관련 법령, 서비스 구조 또는 운영 정책 변경이 있는 경우 약관을 수정할 수 있습니다.",
        "이용자에게 불리한 변경이 있는 경우 시행일 전에 합리적인 방법으로 이를 공지합니다.",
        "변경 약관 시행 후에도 서비스를 계속 이용하는 경우 특별한 사정이 없는 한 변경된 약관에 동의한 것으로 봅니다.",
      ],
    },
    {
      heading: "제5조(약관 외 준칙)",
      paragraphs: [
        "본 약관에 명시되지 않은 사항은 관련 법령, 개인정보처리방침, 서비스 내 개별 정책 및 일반적인 거래관행에 따릅니다.",
      ],
    },
    {
      heading: "제6조(이용계약의 성립)",
      bullets: [
        "회원 이용계약은 이용자가 회원가입 절차에서 필요한 정보를 입력하고 본 약관 및 개인정보처리방침에 동의한 후 운영자가 이를 수락함으로써 성립합니다.",
        "Google 로그인을 이용하는 경우 이용자는 해당 인증 제공자의 인증 절차와 필요한 정보 제공에 동의한 것으로 봅니다.",
        "비회원 이용은 회원가입 없이 허용되는 범위 내에서 서비스에 접속하거나 채널에 참여하는 시점부터 본 약관의 적용을 받습니다.",
      ],
    },
    {
      heading: "제7조(서비스 이용 신청)",
      paragraphs: [
        "회원가입을 원하는 이용자는 운영자가 제공하는 양식에 따라 필요한 정보를 정확하게 입력하여야 하며, 허위 정보 또는 타인의 정보로 가입하여서는 안 됩니다.",
      ],
    },
    {
      heading: "제8조(이용신청의 승낙, 거부 및 유보)",
      bullets: [
        "운영자는 원칙적으로 정상적인 이용신청에 대하여 가입 또는 이용을 승인합니다.",
        "다만 허위 정보 기재, 타인 정보 도용, 약관 위반 이력, 서비스 안정성 저해 우려, 법령 위반 또는 부당한 목적이 확인되는 경우 이용신청을 거부하거나 사후 이용을 제한할 수 있습니다.",
        "기술적 장애, 보안 점검, 본인 확인 필요 등 합리적인 사유가 있는 경우 승낙을 유보할 수 있습니다.",
      ],
    },
    {
      heading: "제9조(회원정보의 변경 및 보호)",
      bullets: [
        "회원은 등록한 정보에 변경이 있는 경우 지체 없이 수정하여야 합니다.",
        "회원이 정보를 수정하지 않아 발생하는 불이익은 해당 회원이 부담합니다.",
        "운영자는 개인정보처리방침에 따라 이용자 정보를 보호하기 위하여 노력합니다.",
      ],
    },
    {
      heading: "제10조(이용계약의 종료)",
      bullets: [
        "회원은 언제든지 서비스가 제공하는 탈퇴 절차 또는 운영자에게의 요청을 통해 이용계약을 종료할 수 있습니다.",
        "운영자는 이용자가 본 약관 또는 법령을 중대하게 위반한 경우 이용계약을 해지하거나 서비스 이용을 제한할 수 있습니다.",
        "서비스 안전, 타 이용자 보호, 법적 의무 이행을 위하여 필요한 경우 사전 통지 없이 긴급 제한이 먼저 이루어질 수 있습니다.",
      ],
    },
    {
      heading: "제11조(회원관리 및 이용제한)",
      bullets: [
        "운영자는 약관 위반, 신고 누적, 스팸, 차단 우회, 악성 자동화, 타인 권리 침해, 서비스 방해 행위가 있는 이용자에 대하여 경고, 게시물 삭제, 채널 제한, 신고 처리, 일시 정지, 영구 제한 등의 조치를 할 수 있습니다.",
        "회원 또는 비회원이 서비스 운영을 심각하게 방해하거나 안전을 해치는 경우 익명 식별값, 기기 식별값 또는 계정 기준으로 차단할 수 있습니다.",
        "운영자는 필요한 경우 소명 기회를 부여할 수 있으나, 긴급 보안 또는 안전 조치가 우선될 수 있습니다.",
      ],
    },
    {
      heading: "제12조(서비스 제공기간 및 중단)",
      bullets: [
        "서비스 이용기간은 회원의 경우 이용계약 성립 시점부터 종료 시점까지이며, 비회원의 경우 허용된 범위에서 서비스를 이용하는 동안입니다.",
        "운영자는 점검, 보수, 교체, 장애, 트래픽 급증, 외부 인프라 장애 또는 기타 상당한 사유가 있는 경우 서비스의 전부 또는 일부를 일시 중단할 수 있습니다.",
        "운영자는 가능한 범위에서 중단 사실과 사유를 사전 또는 사후에 공지합니다.",
      ],
    },
    {
      heading: "제13조(이용료)",
      paragraphs: [
        "서비스는 현재 무료로 제공됩니다.",
        "향후 유료 기능 또는 별도 요금제가 도입되는 경우 운영자는 적용 내용, 결제 조건, 환불 기준 등을 별도 공지 또는 약관을 통해 안내합니다.",
      ],
    },
    {
      heading: "제14조(서비스의 내용)",
      bullets: [
        "링크 기반 채널 입장 및 익명 또는 회원 기반 채팅 기능",
        "채널 생성, 관리, 규칙 설정, 공지, 동결, 신고 및 차단 등 채널 운영 기능",
        "답글, 반응, 검색, 이미지 업로드, 링크 미리보기, 라이브 세션 등 대화 확장 기능",
        "운영자 신고 처리, 1:1 지원, 가이드형 지원 흐름, 대시보드 및 개인 설정 기능",
      ],
    },
    {
      heading: "제15조(광고 및 외부 연결)",
      paragraphs: [
        "운영자는 서비스 화면에 외부 링크, 미리보기, 참고 연결 또는 향후 필요한 공지성 배너를 표시할 수 있습니다.",
        "이용자가 외부 사이트 또는 외부 서비스로 이동한 이후의 거래, 이용, 정보처리에는 해당 외부 서비스의 정책이 적용됩니다.",
      ],
    },
    {
      heading: "제16조(게시물의 권리 및 이용)",
      bullets: [
        "이용자가 작성한 게시물의 저작권은 원칙적으로 해당 이용자에게 있습니다.",
        "이용자는 서비스 운영, 전송, 저장, 표시, 백업, 검색, 신고 검토 및 분쟁 대응에 필요한 범위 내에서 운영자에게 게시물 이용에 대한 비독점적 사용권을 부여합니다.",
        "운영자는 법령 위반, 권리 침해, 안전 문제 또는 운영상 필요가 있는 경우 게시물을 삭제, 비공개 처리하거나 접근을 제한할 수 있습니다.",
      ],
    },
    {
      heading: "제17조(지식재산권)",
      bullets: [
        "서비스 자체의 구조, UI, 로고, 코드, 데이터베이스 및 운영자가 작성한 저작물에 대한 권리는 운영자 또는 정당한 권리자에게 귀속합니다.",
        "이용자는 운영자의 사전 동의 없이 서비스를 복제, 배포, 역설계, 판매, 재사용하거나 이를 제3자에게 이용하게 하여서는 안 됩니다.",
      ],
    },
    {
      heading: "제18조(금지행위)",
      bullets: [
        "허위 정보 입력, 타인 명의 도용, 계정 또는 익명 식별값의 부정 사용",
        "욕설, 혐오, 협박, 성희롱, 음란물, 불법 촬영물, 스팸, 사기, 불법 홍보 또는 법령 위반 게시물의 작성",
        "서비스의 차단, 제한, 신고, 동결 또는 보안 장치를 우회하려는 행위",
        "자동화 도구, 스크립트, 과도한 요청 등으로 서비스 운영을 방해하는 행위",
        "다른 이용자의 개인정보를 무단 수집, 저장, 공개하거나 외부로 유출하는 행위",
        "운영자 또는 제3자의 권리, 명예, 신용 또는 정당한 이익을 침해하는 행위",
      ],
    },
    {
      heading: "제19조(운영자의 의무)",
      bullets: [
        "운영자는 관련 법령을 준수하고 지속적인 서비스 제공을 위하여 노력합니다.",
        "운영자는 이용자의 개인정보를 보호하기 위하여 개인정보처리방침을 수립하고 합리적인 보안 조치를 시행합니다.",
        "운영자는 서비스 이용과 관련한 정당한 의견이나 불만이 접수된 경우 합리적인 범위에서 이를 검토하고 처리합니다.",
      ],
    },
    {
      heading: "제20조(이용자의 의무)",
      bullets: [
        "이용자는 본 약관, 개인정보처리방침, 서비스 내 안내 및 관련 법령을 준수하여야 합니다.",
        "이용자는 자신의 계정, 비밀번호, 로그인 수단 및 접근기기를 스스로 관리하여야 하며, 제3자에게 양도하거나 공유해서는 안 됩니다.",
        "이용자는 서비스 내에서 취득한 타인의 정보와 콘텐츠를 법령 및 권리 범위 내에서만 이용하여야 합니다.",
      ],
    },
    {
      heading: "제21조(계정 및 인증정보 관리)",
      bullets: [
        "회원은 이메일 주소, 비밀번호 및 연동 로그인 수단을 본인이 책임지고 관리하여야 합니다.",
        "인증정보 유출 또는 무단 사용이 의심되는 경우 즉시 비밀번호 변경 또는 운영자 문의 등 필요한 조치를 하여야 합니다.",
        "회원의 관리 소홀로 발생한 손해에 대하여 운영자의 고의 또는 중과실이 없는 한 운영자는 책임을 지지 않습니다.",
      ],
    },
    {
      heading: "제22조(통지)",
      bullets: [
        "운영자는 공지사항, 서비스 화면, 이메일 또는 그에 준하는 방법으로 이용자에게 통지할 수 있습니다.",
        "불특정 다수 이용자에 대한 통지는 서비스 내 게시로 갈음할 수 있습니다.",
      ],
    },
    {
      heading: "제23조(개인정보 보호)",
      paragraphs: [
        "이용자의 개인정보 처리에 관한 사항은 별도로 게시되는 개인정보처리방침에 따릅니다.",
      ],
    },
    {
      heading: "제24조(손해배상)",
      paragraphs: [
        "이용자가 본 약관 또는 관련 법령을 위반하여 운영자 또는 제3자에게 손해를 발생하게 한 경우 해당 이용자는 그 손해를 배상할 책임이 있습니다.",
      ],
    },
    {
      heading: "제25조(운영자의 면책)",
      bullets: [
        "운영자는 천재지변, 기간통신사업자의 장애, 외부 인프라 장애, 불가항력 또는 이용자의 귀책사유로 인한 서비스 이용 장애에 대하여 책임을 지지 않습니다.",
        "운영자는 이용자가 서비스에 게시하거나 전송한 정보의 정확성, 신뢰성, 적법성을 보증하지 않습니다.",
        "운영자는 이용자 상호 간 또는 이용자와 제3자 간 분쟁에 직접 개입할 의무가 없으며, 관련 손해에 대하여 법령상 책임이 없는 한 책임을 지지 않습니다.",
      ],
    },
    {
      heading: "제26조(준거법 및 관할)",
      paragraphs: [
        "본 약관과 서비스 이용에 관한 분쟁에는 대한민국 법령이 적용됩니다.",
        "운영자와 이용자 사이에 소송이 제기되는 경우 민사소송법에 따른 관할법원을 전속적 합의가 없는 한 관할법원으로 합니다.",
      ],
    },
    {
      heading: "제27조(기타)",
      bullets: [
        "운영자는 서비스의 전부 또는 일부를 개선, 변경, 중단할 수 있으며, 중대한 변경은 합리적인 방법으로 공지합니다.",
        "이용자는 운영자의 사전 서면 동의 없이 본 약관상 지위 또는 권리·의무를 양도할 수 없습니다.",
        "본 약관의 일부 조항이 무효 또는 집행불능이 되더라도 나머지 조항의 효력에는 영향을 미치지 않습니다.",
      ],
    },
    {
      heading: "부칙",
      paragraphs: [
        "본 약관은 2025년 5월 1일부터 시행합니다.",
      ],
    },
  ],
};

const termsEn: LegalDocumentContent = {
  intro:
    "These Terms are written to reflect the current structure and features of yap. as it is operated today.",
  effectiveDate: "May 1, 2025",
  lastUpdated: "July 31, 2026",
  sections: [
    {
      heading: "Article 1 (Purpose)",
      paragraphs: [
        "These Terms of Service set out the rights, obligations, responsibilities, and conditions governing use of yap. (the \"Service\") between Yang Soyeon, the individual operator of the Service (the \"Operator\"), and each user.",
      ],
    },
    {
      heading: "Article 2 (Definitions)",
      bullets: [
        "\"User\" means any member or non-member who uses the Service under these Terms.",
        "\"Member\" means a person who creates an account using email credentials or Google sign-in and uses the Service.",
        "\"Non-member\" means a person who uses parts of the Service, such as anonymous channel access or support flows, without registering an account.",
        "\"Channel\" means a conversation space that users join through a link or operate through the Service.",
        "\"Content\" means any information entered or uploaded through the Service, including messages, replies, images, reports, DMs, or support submissions.",
        "\"Operator\" means the individual responsible for operating, managing, moderating, and supporting the Service.",
      ],
    },
    {
      heading: "Article 3 (Scope and Effect)",
      bullets: [
        "These Terms apply to all users who access or use the Service.",
        "Separate notices or policies shown for a particular feature form part of these Terms.",
        "If a special rule for a particular feature conflicts with these Terms, the special rule will control for that feature.",
      ],
    },
    {
      heading: "Article 4 (Posting and Amendment of the Terms)",
      bullets: [
        "The Operator posts these Terms through the Service's legal notice pages.",
        "The Operator may revise these Terms when laws, Service structure, or operational policies change.",
        "If a change is materially unfavorable to users, reasonable advance notice will be provided before the effective date.",
        "Continued use of the Service after the revised Terms take effect will generally be treated as acceptance of the revised Terms.",
      ],
    },
    {
      heading: "Article 5 (Rules Outside These Terms)",
      paragraphs: [
        "Any matter not expressly addressed in these Terms is governed by applicable law, the Privacy Policy, feature-specific policies, and general commercial practice.",
      ],
    },
    {
      heading: "Article 6 (Formation of the User Agreement)",
      bullets: [
        "For members, the user agreement is formed when a user completes registration, provides required information, agrees to these Terms and the Privacy Policy, and the Operator accepts the registration.",
        "When Google sign-in is used, the user is deemed to agree to the relevant authentication process and the provision of information necessary for that process.",
        "For non-members, these Terms apply from the moment the user accesses or participates in a part of the Service that is available without registration.",
      ],
    },
    {
      heading: "Article 7 (Application for Use)",
      paragraphs: [
        "A person seeking to register must accurately provide the required information through the registration form and must not apply using false information or another person's identity.",
      ],
    },
    {
      heading: "Article 8 (Acceptance, Refusal, and Reservation)",
      bullets: [
        "The Operator will generally accept a normal request to use the Service.",
        "However, use may be refused or later restricted if false information, identity misuse, prior Terms violations, risk to Service stability, unlawful conduct, or an improper purpose is identified.",
        "Acceptance may be deferred where technical issues, security checks, or identity verification are reasonably necessary.",
      ],
    },
    {
      heading: "Article 9 (Changes to Member Information and Protection)",
      bullets: [
        "Members must promptly update their registered information when it changes.",
        "Any disadvantage caused by failure to update that information is the member's responsibility.",
        "The Operator will make reasonable efforts to protect user information in accordance with the Privacy Policy.",
      ],
    },
    {
      heading: "Article 10 (Termination of the User Agreement)",
      bullets: [
        "A member may terminate the user agreement at any time through the withdrawal process provided by the Service or by contacting the Operator.",
        "The Operator may terminate the agreement or restrict access where the user materially violates these Terms or applicable law.",
        "Where necessary for safety, legal compliance, or protection of other users, urgent restrictions may be applied before notice is given.",
      ],
    },
    {
      heading: "Article 11 (User Management and Restrictions)",
      bullets: [
        "The Operator may issue warnings, delete content, restrict channels, process reports, suspend use, or permanently ban users who violate these Terms or engage in abuse, spam, block evasion, malicious automation, rights infringement, or behavior harmful to Service safety.",
        "Users may be blocked by account, anonymous identity, or device-linked identifier where necessary to protect the Service or other users.",
        "The Operator may provide an opportunity to explain, but urgent safety or security action may take priority.",
      ],
    },
    {
      heading: "Article 12 (Service Period and Suspension)",
      bullets: [
        "For members, the Service period runs from formation of the user agreement until termination. For non-members, it lasts while the user accesses the portions of the Service made available to them.",
        "The Operator may suspend all or part of the Service for maintenance, inspection, replacement, failure, traffic surges, third-party infrastructure issues, or other substantial reasons.",
        "Where reasonably possible, notice of the interruption and its cause will be given in advance or afterward.",
      ],
    },
    {
      heading: "Article 13 (Fees)",
      paragraphs: [
        "The Service is currently offered free of charge.",
        "If paid features or plans are introduced in the future, the Operator will separately announce the applicable pricing, payment terms, and refund rules.",
      ],
    },
    {
      heading: "Article 14 (Service Contents)",
      bullets: [
        "Link-based channel access and anonymous or account-based chat participation",
        "Channel creation, management, rules, notices, freezing, reporting, and blocking tools",
        "Replies, reactions, search, image upload, link previews, and live-session features",
        "Moderation handling, one-to-one support, guided support flows, dashboard views, and personal settings",
      ],
    },
    {
      heading: "Article 15 (Advertising and External Links)",
      paragraphs: [
        "The Operator may display external links, previews, reference destinations, or future notice banners within the Service.",
        "Once a user moves to an external site or third-party service, the policies and terms of that external service apply to its transactions, use, and data handling.",
      ],
    },
    {
      heading: "Article 16 (Rights in User Content and Operational Use)",
      bullets: [
        "Copyright in content created by a user generally remains with that user.",
        "The user grants the Operator a non-exclusive license to store, transmit, display, back up, search, review, and otherwise use the content as necessary to operate the Service, review reports, and handle disputes.",
        "The Operator may delete, hide, or restrict access to content where necessary for legal compliance, rights protection, safety, or Service operation.",
      ],
    },
    {
      heading: "Article 17 (Intellectual Property)",
      bullets: [
        "Rights in the Service itself, including its structure, UI, logo, code, databases, and operator-created works, belong to the Operator or the relevant rights holder.",
        "Users may not reproduce, distribute, reverse engineer, sell, reuse, or allow third parties to use the Service without prior consent, except as permitted by law.",
      ],
    },
    {
      heading: "Article 18 (Prohibited Conduct)",
      bullets: [
        "Providing false information, misusing another person's identity, or using accounts or anonymous identifiers improperly",
        "Posting abusive, hateful, threatening, sexually harassing, obscene, illegal, spam, fraudulent, or otherwise unlawful content",
        "Attempting to evade moderation, reporting, freezing, blocking, or security measures",
        "Using bots, scripts, scraping, or excessive requests to disrupt Service operation",
        "Collecting, storing, disclosing, or leaking other users' personal information without authorization",
        "Infringing the rights, reputation, credit, or legitimate interests of the Operator or any third party",
      ],
    },
    {
      heading: "Article 19 (Operator Obligations)",
      bullets: [
        "The Operator will comply with applicable law and make reasonable efforts to provide the Service continuously.",
        "The Operator will establish a Privacy Policy and take reasonable security measures to protect personal information.",
        "The Operator will review and handle legitimate opinions or complaints related to Service use within a reasonable scope.",
      ],
    },
    {
      heading: "Article 20 (User Obligations)",
      bullets: [
        "Users must comply with these Terms, the Privacy Policy, in-Service guidance, and applicable law.",
        "Users must manage their own accounts, passwords, sign-in methods, and access devices and must not transfer or share them with third parties.",
        "Users may use information and content obtained through the Service only within the limits permitted by law and applicable rights.",
      ],
    },
    {
      heading: "Article 21 (Account and Credential Management)",
      bullets: [
        "Members are responsible for managing their own email address, password, and connected sign-in methods.",
        "If credential leakage or unauthorized use is suspected, the member must promptly take protective steps such as changing the password or contacting the Operator.",
        "The Operator is not responsible for loss caused by poor credential management unless the loss results from the Operator's intentional misconduct or gross negligence.",
      ],
    },
    {
      heading: "Article 22 (Notices)",
      bullets: [
        "The Operator may provide notice through announcements, Service screens, email, or similar methods.",
        "Notice to unspecified multiple users may be provided through posting within the Service in place of individual notice.",
      ],
    },
    {
      heading: "Article 23 (Privacy Protection)",
      paragraphs: [
        "Matters concerning the processing of personal information are governed by the separately posted Privacy Policy.",
      ],
    },
    {
      heading: "Article 24 (Damages)",
      paragraphs: [
        "If a user violates these Terms or applicable law and causes damage to the Operator or a third party, that user is responsible for compensating the resulting damage.",
      ],
    },
    {
      heading: "Article 25 (Limitation of Liability)",
      bullets: [
        "The Operator is not liable for Service disruption caused by force majeure, telecommunications failure, third-party infrastructure outages, or reasons attributable to the user.",
        "The Operator does not guarantee the accuracy, reliability, or legality of information posted or transmitted by users.",
        "The Operator is not obligated to intervene directly in disputes between users or between a user and a third party, and is not liable for related damage except where liability is imposed by law.",
      ],
    },
    {
      heading: "Article 26 (Governing Law and Jurisdiction)",
      paragraphs: [
        "These Terms and disputes relating to the Service are governed by the laws of the Republic of Korea.",
        "Any lawsuit between the Operator and a user will be subject to the court having jurisdiction under the Civil Procedure Act, unless another mandatory forum applies.",
      ],
    },
    {
      heading: "Article 27 (Miscellaneous)",
      bullets: [
        "The Operator may improve, modify, or discontinue all or part of the Service, and material changes will be announced by a reasonable method.",
        "Users may not assign their status under these Terms or any rights or obligations arising from them without the Operator's prior written consent.",
        "If any provision of these Terms is held invalid or unenforceable, the remaining provisions remain in effect.",
      ],
    },
    {
      heading: "Supplementary Provision",
      paragraphs: [
        "These Terms take effect on May 1, 2025.",
      ],
    },
  ],
};

export const legalDocuments: Record<"privacy" | "terms", Record<"ko" | "en", LegalDocumentContent>> = {
  privacy: {
    ko: privacyKo,
    en: privacyEn,
  },
  terms: {
    ko: termsKo,
    en: termsEn,
  },
};
