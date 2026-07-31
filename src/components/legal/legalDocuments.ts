export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalVersionContent {
  heading: string;
  sections: LegalSection[];
}

export interface LegalDocumentContent {
  intro: string;
  versions: LegalVersionContent[];
}

export const legalDocuments: Record<"privacy" | "terms", Record<"ko" | "en", LegalDocumentContent>> = {
  privacy: {
    ko: {
      intro: "아래 방침은 개인이 운영하는 yap. 서비스 구조를 기준으로 정리한 개인정보처리방침입니다.",
      versions: [
        {
          heading: "한국어 버전",
          sections: [
            {
              heading: "개인정보처리방침",
              paragraphs: ["시행일: 2025년 5월 1일", "최종 업데이트: 2026년 7월 31일"],
            },
            {
              heading: "제1조 목적",
              paragraphs: [
                "yap.(이하 \"서비스\")는 개인이 운영하는 프로젝트이며, 본 방침에서 해당 운영 개인을 \"운영자\"라고 합니다. 운영자는 서비스를 이용하는 개인의 개인정보를 보호하고 관련 법령을 준수하기 위하여 본 개인정보처리방침을 수립합니다.",
              ],
            },
            {
              heading: "제2조 개인정보 처리 원칙",
              paragraphs: [
                "운영자는 관련 법령과 본 방침에 따라 개인정보를 수집·이용하며, 법적 근거가 있거나 이용자의 동의가 있는 경우에 한하여 필요한 범위 내에서 개인정보를 제공 또는 처리합니다.",
              ],
            },
            {
              heading: "제3조 본 방침의 공개 및 변경",
              bullets: [
                "운영자는 이용자가 언제든지 쉽게 확인할 수 있도록 본 방침을 서비스 화면에 공개합니다.",
                "관련 법령, 서비스 정책 또는 기능 변경이 있는 경우 본 방침은 수정될 수 있습니다.",
                "중요한 변경이 있는 경우 서비스 내 공지 또는 합리적인 방법으로 사전에 안내합니다.",
              ],
            },
            {
              heading: "제4조 수집하는 개인정보",
              bullets: [
                "회원가입 및 로그인 정보: 이메일 주소, 비밀번호, 닉네임 또는 이름",
                "소셜 로그인 정보: Google 로그인 이용 시 인증에 필요한 계정 식별정보 및 기본 프로필 정보",
                "서비스 이용 과정에서 생성되는 정보: IP 주소, 쿠키, 접속 기록, 기기 및 브라우저 정보, 서비스 이용 기록",
                "익명·비회원 이용 관련 정보: 서비스가 발급한 익명 식별 토큰, 기기 식별 토큰, 최근 접속 채널 정보",
                "고객지원 및 신고 처리 정보: 문의 내용, 신고 내용, 지원 세션 기록, 운영 처리 기록",
              ],
            },
            {
              heading: "제5조 개인정보 수집 방법",
              bullets: [
                "이용자가 회원가입, 로그인, 채널 이용, 고객지원 또는 신고 기능을 사용하는 과정에서 직접 입력하는 방식",
                "서비스 이용 중 브라우저, 기기, 네트워크 환경에서 자동으로 생성되는 정보를 수집하는 방식",
                "이메일 인증, 비밀번호 재설정 등 운영자가 제공하는 보조 절차를 통해 수집하는 방식",
              ],
            },
            {
              heading: "제6조 개인정보 이용 목적",
              bullets: [
                "회원 식별, 로그인 처리, 계정 유지 및 본인 확인",
                "채널, 채팅, 신고, 운영자 검토, 고객지원 및 1:1 지원 기능 제공",
                "서비스 안정성 확보, 악용 방지, 차단·제한 조치, 보안 대응",
                "이용문의 대응, 불만 처리, 분쟁 대응, 공지 전달",
                "서비스 품질 개선, 이용 통계 및 운영 분석",
              ],
            },
            {
              heading: "제7조 개인정보 제3자 제공",
              bullets: [
                "운영자는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다.",
                "다만, 이용자가 Google OAuth 로그인을 선택한 경우 로그인 제공을 위하여 필요한 범위에서 Google과 인증 정보가 연동될 수 있습니다.",
                "법령에 따른 요청, 수사기관의 적법한 요구, 이용자 동의가 있는 경우에는 예외적으로 제공될 수 있습니다.",
              ],
            },
            {
              heading: "제8조 개인정보 처리 위탁 또는 외부 서비스 이용",
              bullets: [
                "운영자는 이메일 인증 및 비밀번호 재설정 메일 발송을 위해 외부 이메일 발송 서비스를 이용할 수 있습니다.",
                "운영자는 서비스 호스팅, 저장, 보안 및 성능 제공을 위해 클라우드 인프라 또는 플랫폼 사업자를 이용할 수 있습니다.",
                "운영자는 위와 같은 외부 서비스 이용 시 관련 법령에 따라 필요한 보호조치를 취합니다.",
              ],
            },
            {
              heading: "제9조 개인정보 보유 및 이용기간",
              bullets: [
                "운영자는 개인정보 수집·이용 목적이 달성될 때까지 개인정보를 보유·이용합니다.",
                "회원 탈퇴 또는 계정 삭제 후에도 관계 법령 또는 분쟁 대응, 악용 방지 목적상 필요한 정보는 일정 기간 보관될 수 있습니다.",
                "서비스 악용 방지, 중복 가입 방지, 보안 대응을 위한 기록은 내부 기준에 따라 최대 1년 범위 내에서 보관될 수 있습니다.",
                "고객지원, 신고, 운영 감사 기록은 법적 의무 또는 합리적인 운영 목적이 있는 기간 동안 보관될 수 있습니다.",
              ],
            },
            {
              heading: "제10조 법령에 따른 보유기간",
              bullets: [
                "전자상거래 등에서의 소비자보호에 관한 법률에 따라 계약·청약철회 관련 기록 5년, 대금결제 및 재화 등의 공급에 관한 기록 5년, 소비자 불만 또는 분쟁처리 기록 3년, 표시·광고 기록 6개월",
                "통신비밀보호법에 따라 웹사이트 로그 기록 자료(접속 IP 주소 등) 3개월",
                "그 밖에 관련 법령이 정한 보존기간이 있는 경우 해당 기간",
              ],
            },
            {
              heading: "제11조 개인정보 파기",
              bullets: [
                "개인정보 보유기간이 경과하거나 처리 목적이 달성된 경우 지체 없이 파기합니다.",
                "전자적 파일 형태의 정보는 복구 또는 재생이 어렵도록 삭제합니다.",
                "종이 문서는 분쇄 또는 소각 등의 방법으로 파기합니다.",
              ],
            },
            {
              heading: "제12조 이용자의 권리와 행사 방법",
              bullets: [
                "이용자는 언제든지 자신의 개인정보 열람, 정정, 삭제 또는 처리정지를 요청할 수 있습니다.",
                "회원은 서비스 내 계정 설정 또는 운영자가 제공하는 지원 경로를 통해 개인정보 관련 요청을 할 수 있습니다.",
                "운영자는 관련 법령에 따라 지체 없이 필요한 조치를 검토하고 처리합니다.",
              ],
            },
            {
              heading: "제13조 이용자의 의무",
              bullets: [
                "이용자는 자신의 개인정보를 최신 상태로 유지해야 하며, 부정확한 정보 입력으로 인한 책임은 이용자에게 있습니다.",
                "타인의 개인정보를 도용하거나 허위 정보를 이용하여 가입해서는 안 됩니다.",
                "이용자는 이메일 주소, 비밀번호 및 기타 인증정보를 스스로 안전하게 관리해야 합니다.",
              ],
            },
            {
              heading: "제14조 개인정보 유출 등에 대한 조치",
              bullets: [
                "운영자는 개인정보 유출, 분실 또는 훼손 사실을 인지한 경우 관련 법령에 따라 지체 없이 대응하고 필요한 통지 및 신고를 진행합니다.",
                "이용자가 취할 수 있는 조치, 대응 현황, 문의 경로 등을 관련 법령이 요구하는 범위에서 안내합니다.",
              ],
            },
            {
              heading: "제15조 쿠키 및 자동 수집 장치",
              bullets: [
                "운영자는 로그인 유지, 환경설정 저장, 접근 제어 및 서비스 상태 유지를 위해 쿠키 또는 유사한 저장수단을 사용할 수 있습니다.",
                "이용자는 브라우저 설정을 통해 쿠키 허용 또는 차단을 선택할 수 있습니다.",
                "다만 쿠키를 차단할 경우 로그인 유지 또는 일부 서비스 이용에 어려움이 있을 수 있습니다.",
              ],
            },
            {
              heading: "제16조 개인정보 보호 책임자",
              paragraphs: [
                "성명: 양소연",
                "구분: 서비스 운영자",
                "이메일: yang82soyeon@gmail.com",
              ],
            },
            {
              heading: "제17조 권익침해 구제방법",
              bullets: [
                "개인정보분쟁조정위원회: 1833-6972 / www.kopico.go.kr",
                "개인정보침해신고센터: 118 / privacy.kisa.or.kr",
                "대검찰청: 1301 / www.spo.go.kr",
                "경찰청: 182 / ecrm.cyber.go.kr",
              ],
            },
            {
              heading: "부칙",
              paragraphs: [
                "본 방침은 2025년 5월 1일부터 시행합니다.",
              ],
            },
          ],
        },
        {
          heading: "English Version",
          sections: [
            {
              heading: "Privacy Policy",
              paragraphs: ["Effective date: May 1, 2025", "Last updated: July 31, 2026"],
            },
            {
              heading: "1. Purpose",
              paragraphs: [
                "yap. (the \"Service\") is a personally operated project. In this Policy, the individual who runs the Service is referred to as the \"Operator.\" The Operator establishes this Privacy Policy to protect the personal information of individuals who use the Service and to comply with applicable privacy and data protection laws.",
              ],
            },
            {
              heading: "2. Privacy Processing Principles",
              paragraphs: [
                "The operator collects and uses personal information in accordance with applicable law and this Policy, and only provides or otherwise processes personal information where a lawful basis or the user's consent exists.",
              ],
            },
            {
              heading: "3. Publication and Changes to This Policy",
              bullets: [
                "This Policy is made available through the Service so users can review it easily.",
                "This Policy may be updated when laws, Service features, or internal policies change.",
                "Material changes will be announced in advance through the Service or another reasonable method.",
              ],
            },
            {
              heading: "4. Personal Information Collected",
              bullets: [
                "Sign-up and login information: email address, password, nickname or name",
                "Social login information: account identifier and basic profile information required for Google sign-in",
                "Information generated while using the Service: IP address, cookies, access logs, browser and device information, and Service usage records",
                "Guest or anonymous access information: anonymous identity tokens, device identity tokens, and recent-channel state used by the Service",
                "Support and reporting information: support messages, report content, support-session history, and moderation handling records",
              ],
            },
            {
              heading: "5. Methods of Collection",
              bullets: [
                "Information entered directly when a user signs up, logs in, joins channels, submits reports, or uses support flows",
                "Information automatically generated from the browser, device, or network environment during Service use",
                "Information collected during supporting processes such as email verification and password reset",
              ],
            },
            {
              heading: "6. Purposes of Use",
              bullets: [
                "Account identification, login handling, and user verification",
                "Providing channels, chat, reporting, moderation review, guided support, and one-to-one support functions",
                "Ensuring Service stability, preventing abuse, enforcing restrictions, and handling security issues",
                "Responding to inquiries, complaints, disputes, and operational notices",
                "Improving the Service through operational analytics and usage statistics",
              ],
            },
            {
              heading: "7. Third-Party Provision",
              bullets: [
                "The operator does not provide personal information to third parties as a general rule.",
                "If a user chooses Google OAuth sign-in, necessary authentication data may be exchanged with Google for login processing.",
                "Personal information may also be disclosed where required by law, by a lawful government request, or with the user's consent.",
              ],
            },
            {
              heading: "8. Outsourced Processing or External Services",
              bullets: [
                "The operator may use an external email delivery service to send verification emails and password reset emails.",
                "The operator may rely on cloud infrastructure or platform providers for hosting, storage, security, and performance.",
                "Appropriate safeguards are applied when using such external services in accordance with applicable law.",
              ],
            },
            {
              heading: "9. Retention Period",
              bullets: [
                "Personal information is retained for as long as necessary to fulfill the purposes for which it was collected.",
                "Even after account deletion, some information may be retained where required by law or reasonably necessary for dispute resolution, abuse prevention, or security.",
                "Records used to prevent abuse, repeated registration, or security misuse may be retained for up to one year under internal standards.",
                "Support, reporting, and audit records may be retained for legal or reasonable operational purposes.",
              ],
            },
            {
              heading: "10. Statutory Retention Periods",
              bullets: [
                "Under applicable consumer protection laws: records on contracts or withdrawal requests for 5 years, payment and supply records for 5 years, complaint or dispute records for 3 years, and advertising records for 6 months",
                "Under communications privacy laws: website access log records, including IP address logs, for 3 months",
                "Any other retention period required by applicable law",
              ],
            },
            {
              heading: "11. Deletion of Personal Information",
              bullets: [
                "Personal information is deleted without undue delay when the retention period expires or the processing purpose has been achieved.",
                "Electronic records are deleted using methods that make restoration difficult.",
                "Printed documents are destroyed by shredding, incineration, or comparable methods.",
              ],
            },
            {
              heading: "12. User Rights",
              bullets: [
                "Users may request access to, correction of, deletion of, or suspension of processing of their personal information.",
                "Members may submit privacy-related requests through account settings or support channels provided by the Service.",
                "The operator will review and handle such requests in accordance with applicable law.",
              ],
            },
            {
              heading: "13. User Responsibilities",
              bullets: [
                "Users must keep their personal information accurate and up to date.",
                "Users must not register using another person's information or false information.",
                "Users are responsible for safeguarding their email address, password, and other authentication credentials.",
              ],
            },
            {
              heading: "14. Response to Breaches",
              bullets: [
                "If the operator becomes aware of loss, leakage, or damage involving personal information, the operator will respond without undue delay and provide notices or reports required by law.",
                "Where required, the operator will inform users about the affected data, available protective steps, and contact channels.",
              ],
            },
            {
              heading: "15. Cookies and Automatic Collection Tools",
              bullets: [
                "The Service may use cookies or similar storage tools to maintain login sessions, save preferences, control access, and preserve Service state.",
                "Users may choose whether to allow or block cookies through browser settings.",
                "Blocking cookies may make some logged-in or stateful features harder to use.",
              ],
            },
            {
              heading: "16. Privacy Contact",
              paragraphs: [
                "Name: Yang Soyeon",
                "Role: Service Operator",
                "Email: yang82soyeon@gmail.com",
              ],
            },
            {
              heading: "17. Remedies for Privacy Infringement",
              bullets: [
                "Personal Information Dispute Mediation Committee: 1833-6972 / www.kopico.go.kr",
                "Personal Information Infringement Report Center: 118 / privacy.kisa.or.kr",
                "Supreme Prosecutors' Office: 1301 / www.spo.go.kr",
                "National Police Agency: 182 / ecrm.cyber.go.kr",
              ],
            },
            {
              heading: "Supplementary Provision",
              paragraphs: [
                "This Policy takes effect on May 1, 2025.",
              ],
            },
          ],
        },
      ],
    },
    en: {
      intro: "The policy below is a Privacy Policy aligned to yap. as a personally operated project.",
      versions: [
        {
          heading: "한국어 버전",
          sections: [
            {
              heading: "개인정보처리방침",
              paragraphs: ["시행일: 2025년 5월 1일", "최종 업데이트: 2026년 7월 31일"],
            },
            {
              heading: "제1조 목적",
              paragraphs: [
                "yap.(이하 \"서비스\")는 개인이 운영하는 프로젝트이며, 본 방침에서 해당 운영 개인을 \"운영자\"라고 합니다. 운영자는 서비스를 이용하는 개인의 개인정보를 보호하고 관련 법령을 준수하기 위하여 본 개인정보처리방침을 수립합니다.",
              ],
            },
            {
              heading: "제2조 개인정보 처리 원칙",
              paragraphs: [
                "운영자는 관련 법령과 본 방침에 따라 개인정보를 수집·이용하며, 법적 근거가 있거나 이용자의 동의가 있는 경우에 한하여 필요한 범위 내에서 개인정보를 제공 또는 처리합니다.",
              ],
            },
            {
              heading: "제3조 본 방침의 공개 및 변경",
              bullets: [
                "운영자는 이용자가 언제든지 쉽게 확인할 수 있도록 본 방침을 서비스 화면에 공개합니다.",
                "관련 법령, 서비스 정책 또는 기능 변경이 있는 경우 본 방침은 수정될 수 있습니다.",
                "중요한 변경이 있는 경우 서비스 내 공지 또는 합리적인 방법으로 사전에 안내합니다.",
              ],
            },
            {
              heading: "제4조 수집하는 개인정보",
              bullets: [
                "회원가입 및 로그인 정보: 이메일 주소, 비밀번호, 닉네임 또는 이름",
                "소셜 로그인 정보: Google 로그인 이용 시 인증에 필요한 계정 식별정보 및 기본 프로필 정보",
                "서비스 이용 과정에서 생성되는 정보: IP 주소, 쿠키, 접속 기록, 기기 및 브라우저 정보, 서비스 이용 기록",
                "익명·비회원 이용 관련 정보: 서비스가 발급한 익명 식별 토큰, 기기 식별 토큰, 최근 접속 채널 정보",
                "고객지원 및 신고 처리 정보: 문의 내용, 신고 내용, 지원 세션 기록, 운영 처리 기록",
              ],
            },
            {
              heading: "제5조 개인정보 수집 방법",
              bullets: [
                "이용자가 회원가입, 로그인, 채널 이용, 고객지원 또는 신고 기능을 사용하는 과정에서 직접 입력하는 방식",
                "서비스 이용 중 브라우저, 기기, 네트워크 환경에서 자동으로 생성되는 정보를 수집하는 방식",
                "이메일 인증, 비밀번호 재설정 등 운영자가 제공하는 보조 절차를 통해 수집하는 방식",
              ],
            },
            {
              heading: "제6조 개인정보 이용 목적",
              bullets: [
                "회원 식별, 로그인 처리, 계정 유지 및 본인 확인",
                "채널, 채팅, 신고, 운영자 검토, 고객지원 및 1:1 지원 기능 제공",
                "서비스 안정성 확보, 악용 방지, 차단·제한 조치, 보안 대응",
                "이용문의 대응, 불만 처리, 분쟁 대응, 공지 전달",
                "서비스 품질 개선, 이용 통계 및 운영 분석",
              ],
            },
            {
              heading: "제7조 개인정보 제3자 제공",
              bullets: [
                "운영자는 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다.",
                "다만, 이용자가 Google OAuth 로그인을 선택한 경우 로그인 제공을 위하여 필요한 범위에서 Google과 인증 정보가 연동될 수 있습니다.",
                "법령에 따른 요청, 수사기관의 적법한 요구, 이용자 동의가 있는 경우에는 예외적으로 제공될 수 있습니다.",
              ],
            },
            {
              heading: "제8조 개인정보 처리 위탁 또는 외부 서비스 이용",
              bullets: [
                "운영자는 이메일 인증 및 비밀번호 재설정 메일 발송을 위해 외부 이메일 발송 서비스를 이용할 수 있습니다.",
                "운영자는 서비스 호스팅, 저장, 보안 및 성능 제공을 위해 클라우드 인프라 또는 플랫폼 사업자를 이용할 수 있습니다.",
                "운영자는 위와 같은 외부 서비스 이용 시 관련 법령에 따라 필요한 보호조치를 취합니다.",
              ],
            },
            {
              heading: "제9조 개인정보 보유 및 이용기간",
              bullets: [
                "운영자는 개인정보 수집·이용 목적이 달성될 때까지 개인정보를 보유·이용합니다.",
                "회원 탈퇴 또는 계정 삭제 후에도 관계 법령 또는 분쟁 대응, 악용 방지 목적상 필요한 정보는 일정 기간 보관될 수 있습니다.",
                "서비스 악용 방지, 중복 가입 방지, 보안 대응을 위한 기록은 내부 기준에 따라 최대 1년 범위 내에서 보관될 수 있습니다.",
                "고객지원, 신고, 운영 감사 기록은 법적 의무 또는 합리적인 운영 목적이 있는 기간 동안 보관될 수 있습니다.",
              ],
            },
            {
              heading: "제10조 법령에 따른 보유기간",
              bullets: [
                "전자상거래 등에서의 소비자보호에 관한 법률에 따라 계약·청약철회 관련 기록 5년, 대금결제 및 재화 등의 공급에 관한 기록 5년, 소비자 불만 또는 분쟁처리 기록 3년, 표시·광고 기록 6개월",
                "통신비밀보호법에 따라 웹사이트 로그 기록 자료(접속 IP 주소 등) 3개월",
                "그 밖에 관련 법령이 정한 보존기간이 있는 경우 해당 기간",
              ],
            },
            {
              heading: "제11조 개인정보 파기",
              bullets: [
                "개인정보 보유기간이 경과하거나 처리 목적이 달성된 경우 지체 없이 파기합니다.",
                "전자적 파일 형태의 정보는 복구 또는 재생이 어렵도록 삭제합니다.",
                "종이 문서는 분쇄 또는 소각 등의 방법으로 파기합니다.",
              ],
            },
            {
              heading: "제12조 이용자의 권리와 행사 방법",
              bullets: [
                "이용자는 언제든지 자신의 개인정보 열람, 정정, 삭제 또는 처리정지를 요청할 수 있습니다.",
                "회원은 서비스 내 계정 설정 또는 운영자가 제공하는 지원 경로를 통해 개인정보 관련 요청을 할 수 있습니다.",
                "운영자는 관련 법령에 따라 지체 없이 필요한 조치를 검토하고 처리합니다.",
              ],
            },
            {
              heading: "제13조 이용자의 의무",
              bullets: [
                "이용자는 자신의 개인정보를 최신 상태로 유지해야 하며, 부정확한 정보 입력으로 인한 책임은 이용자에게 있습니다.",
                "타인의 개인정보를 도용하거나 허위 정보를 이용하여 가입해서는 안 됩니다.",
                "이용자는 이메일 주소, 비밀번호 및 기타 인증정보를 스스로 안전하게 관리해야 합니다.",
              ],
            },
            {
              heading: "제14조 개인정보 유출 등에 대한 조치",
              bullets: [
                "운영자는 개인정보 유출, 분실 또는 훼손 사실을 인지한 경우 관련 법령에 따라 지체 없이 대응하고 필요한 통지 및 신고를 진행합니다.",
                "이용자가 취할 수 있는 조치, 대응 현황, 문의 경로 등을 관련 법령이 요구하는 범위에서 안내합니다.",
              ],
            },
            {
              heading: "제15조 쿠키 및 자동 수집 장치",
              bullets: [
                "운영자는 로그인 유지, 환경설정 저장, 접근 제어 및 서비스 상태 유지를 위해 쿠키 또는 유사한 저장수단을 사용할 수 있습니다.",
                "이용자는 브라우저 설정을 통해 쿠키 허용 또는 차단을 선택할 수 있습니다.",
                "다만 쿠키를 차단할 경우 로그인 유지 또는 일부 서비스 이용에 어려움이 있을 수 있습니다.",
              ],
            },
            {
              heading: "제16조 개인정보 보호 책임자",
              paragraphs: [
                "성명: 양소연",
                "구분: 서비스 운영자",
                "이메일: yang82soyeon@gmail.com",
              ],
            },
            {
              heading: "제17조 권익침해 구제방법",
              bullets: [
                "개인정보분쟁조정위원회: 1833-6972 / www.kopico.go.kr",
                "개인정보침해신고센터: 118 / privacy.kisa.or.kr",
                "대검찰청: 1301 / www.spo.go.kr",
                "경찰청: 182 / ecrm.cyber.go.kr",
              ],
            },
            {
              heading: "부칙",
              paragraphs: [
                "본 방침은 2025년 5월 1일부터 시행합니다.",
              ],
            },
          ],
        },
        {
          heading: "English Version",
          sections: [
            {
              heading: "Privacy Policy",
              paragraphs: ["Effective date: May 1, 2025", "Last updated: July 31, 2026"],
            },
            {
              heading: "1. Purpose",
              paragraphs: [
                "yap. (the \"Service\") is a personally operated project. In this Policy, the individual who runs the Service is referred to as the \"Operator.\" The Operator establishes this Privacy Policy to protect the personal information of individuals who use the Service and to comply with applicable privacy and data protection laws.",
              ],
            },
            {
              heading: "2. Privacy Processing Principles",
              paragraphs: [
                "The operator collects and uses personal information in accordance with applicable law and this Policy, and only provides or otherwise processes personal information where a lawful basis or the user's consent exists.",
              ],
            },
            {
              heading: "3. Publication and Changes to This Policy",
              bullets: [
                "This Policy is made available through the Service so users can review it easily.",
                "This Policy may be updated when laws, Service features, or internal policies change.",
                "Material changes will be announced in advance through the Service or another reasonable method.",
              ],
            },
            {
              heading: "4. Personal Information Collected",
              bullets: [
                "Sign-up and login information: email address, password, nickname or name",
                "Social login information: account identifier and basic profile information required for Google sign-in",
                "Information generated while using the Service: IP address, cookies, access logs, browser and device information, and Service usage records",
                "Guest or anonymous access information: anonymous identity tokens, device identity tokens, and recent-channel state used by the Service",
                "Support and reporting information: support messages, report content, support-session history, and moderation handling records",
              ],
            },
            {
              heading: "5. Methods of Collection",
              bullets: [
                "Information entered directly when a user signs up, logs in, joins channels, submits reports, or uses support flows",
                "Information automatically generated from the browser, device, or network environment during Service use",
                "Information collected during supporting processes such as email verification and password reset",
              ],
            },
            {
              heading: "6. Purposes of Use",
              bullets: [
                "Account identification, login handling, and user verification",
                "Providing channels, chat, reporting, moderation review, guided support, and one-to-one support functions",
                "Ensuring Service stability, preventing abuse, enforcing restrictions, and handling security issues",
                "Responding to inquiries, complaints, disputes, and operational notices",
                "Improving the Service through operational analytics and usage statistics",
              ],
            },
            {
              heading: "7. Third-Party Provision",
              bullets: [
                "The operator does not provide personal information to third parties as a general rule.",
                "If a user chooses Google OAuth sign-in, necessary authentication data may be exchanged with Google for login processing.",
                "Personal information may also be disclosed where required by law, by a lawful government request, or with the user's consent.",
              ],
            },
            {
              heading: "8. Outsourced Processing or External Services",
              bullets: [
                "The operator may use an external email delivery service to send verification emails and password reset emails.",
                "The operator may rely on cloud infrastructure or platform providers for hosting, storage, security, and performance.",
                "Appropriate safeguards are applied when using such external services in accordance with applicable law.",
              ],
            },
            {
              heading: "9. Retention Period",
              bullets: [
                "Personal information is retained for as long as necessary to fulfill the purposes for which it was collected.",
                "Even after account deletion, some information may be retained where required by law or reasonably necessary for dispute resolution, abuse prevention, or security.",
                "Records used to prevent abuse, repeated registration, or security misuse may be retained for up to one year under internal standards.",
                "Support, reporting, and audit records may be retained for legal or reasonable operational purposes.",
              ],
            },
            {
              heading: "10. Statutory Retention Periods",
              bullets: [
                "Under applicable consumer protection laws: records on contracts or withdrawal requests for 5 years, payment and supply records for 5 years, complaint or dispute records for 3 years, and advertising records for 6 months",
                "Under communications privacy laws: website access log records, including IP address logs, for 3 months",
                "Any other retention period required by applicable law",
              ],
            },
            {
              heading: "11. Deletion of Personal Information",
              bullets: [
                "Personal information is deleted without undue delay when the retention period expires or the processing purpose has been achieved.",
                "Electronic records are deleted using methods that make restoration difficult.",
                "Printed documents are destroyed by shredding, incineration, or comparable methods.",
              ],
            },
            {
              heading: "12. User Rights",
              bullets: [
                "Users may request access to, correction of, deletion of, or suspension of processing of their personal information.",
                "Members may submit privacy-related requests through account settings or support channels provided by the Service.",
                "The operator will review and handle such requests in accordance with applicable law.",
              ],
            },
            {
              heading: "13. User Responsibilities",
              bullets: [
                "Users must keep their personal information accurate and up to date.",
                "Users must not register using another person's information or false information.",
                "Users are responsible for safeguarding their email address, password, and other authentication credentials.",
              ],
            },
            {
              heading: "14. Response to Breaches",
              bullets: [
                "If the operator becomes aware of loss, leakage, or damage involving personal information, the operator will respond without undue delay and provide notices or reports required by law.",
                "Where required, the operator will inform users about the affected data, available protective steps, and contact channels.",
              ],
            },
            {
              heading: "15. Cookies and Automatic Collection Tools",
              bullets: [
                "The Service may use cookies or similar storage tools to maintain login sessions, save preferences, control access, and preserve Service state.",
                "Users may choose whether to allow or block cookies through browser settings.",
                "Blocking cookies may make some logged-in or stateful features harder to use.",
              ],
            },
            {
              heading: "16. Privacy Contact",
              paragraphs: [
                "Name: Yang Soyeon",
                "Role: Service Operator",
                "Email: yang82soyeon@gmail.com",
              ],
            },
            {
              heading: "17. Remedies for Privacy Infringement",
              bullets: [
                "Personal Information Dispute Mediation Committee: 1833-6972 / www.kopico.go.kr",
                "Personal Information Infringement Report Center: 118 / privacy.kisa.or.kr",
                "Supreme Prosecutors' Office: 1301 / www.spo.go.kr",
                "National Police Agency: 182 / ecrm.cyber.go.kr",
              ],
            },
            {
              heading: "Supplementary Provision",
              paragraphs: [
                "This Policy takes effect on May 1, 2025.",
              ],
            },
          ],
        },
      ],
    },
  },
  terms: {
    ko: {
      intro: "아래 약관은 개인이 운영하는 yap. 서비스 구조를 기준으로 정리한 서비스 이용약관 초안입니다.",
      versions: [
        {
          heading: "한국어 버전",
          sections: [
            {
              heading: "시행일 및 최종 업데이트",
              paragraphs: [
                "시행일: 2026년 7월 31일",
                "최종 업데이트: 2026년 7월 31일",
              ],
            },
            {
              heading: "제1조 목적",
              paragraphs: [
                "이 약관은 개인이 운영하는 yap.(이하 \"서비스\", 해당 운영 개인은 이하 \"운영자\")와 이용자 사이의 권리, 의무, 책임사항 및 서비스 이용조건을 정하는 것을 목적으로 합니다.",
              ],
            },
            {
              heading: "제2조 정의",
              bullets: [
                "\"이용자\"는 회원과 비회원을 포함하여 이 약관에 따라 서비스를 이용하는 사람을 말합니다.",
                "\"회원\"은 이메일 또는 소셜 로그인 등 운영자가 제공하는 방식으로 계정을 만들고 로그인한 이용자를 말합니다.",
                "\"비회원\"은 계정을 만들지 않고 공개 채널, 비밀번호 채널, 가이드형 고객지원 등 서비스 일부를 이용하는 이용자를 말합니다.",
                "\"채널\"은 이용자가 만들거나 참여하는 대화 공간을 말합니다.",
                "\"채널 소유자\"는 특정 채널을 생성하거나 관리 권한을 가진 회원을 말합니다.",
                "\"콘텐츠\"는 메시지, 이미지, 채널 이름, 프로필, 배경, 규칙, 신고 내용, 고객지원 문의 등 서비스 내에 입력하거나 업로드한 모든 정보를 말합니다.",
              ],
            },
            {
              heading: "제3조 약관의 게시 및 변경",
              paragraphs: [
                "운영자는 이 약관을 서비스 내에서 확인할 수 있도록 게시합니다.",
                "운영자는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 중요한 변경이 있는 경우 서비스 화면 또는 합리적인 방법으로 사전에 알립니다.",
                "변경 후에도 서비스를 계속 이용하면 변경된 약관에 동의한 것으로 봅니다.",
              ],
            },
            {
              heading: "제4조 서비스 이용",
              bullets: [
                "서비스는 익명 또는 준익명 채팅, 채널 생성 및 관리, 비밀번호 보호 채널, 신고 및 운영자 검토, 가이드형 고객지원 및 1:1 지원 기능 등을 포함할 수 있습니다.",
                "비회원 이용 시 일부 접근 정보나 진행 상태는 브라우저 저장소 또는 서비스가 발급한 접근 토큰에 의존할 수 있습니다.",
                "운영자는 서비스 품질, 안전, 운영정책에 따라 기능을 추가, 변경, 제한 또는 종료할 수 있습니다.",
                "현재 서비스는 별도의 유료 플랜 없이 제공됩니다. 향후 유료 기능이 도입되면 별도 안내와 조건이 적용될 수 있습니다.",
              ],
            },
            {
              heading: "제5조 회원 계정 및 접근 관리",
              bullets: [
                "회원은 본인 정보를 정확하게 제공해야 하며, 계정 정보가 변경되면 지체 없이 반영해야 합니다.",
                "회원은 자신의 로그인 수단, 인증정보, 기기 접근권한을 스스로 관리해야 하며, 이를 제3자에게 공유해서는 안 됩니다.",
                "운영자는 보안상 필요하거나 비정상 사용이 의심되는 경우 추가 확인, 접근 제한 또는 세션 종료 조치를 할 수 있습니다.",
              ],
            },
            {
              heading: "제6조 채널 소유자 책임",
              bullets: [
                "채널 소유자는 채널 이름, 공지, 환영문구, 배경, 비밀번호, 금지어, 차단 및 이의제기 설정 등 자신이 관리하는 채널 구성에 대한 책임을 부담합니다.",
                "채널 소유자는 이용자에게 위법하거나 과도하게 침해적인 행위를 요구해서는 안 됩니다.",
                "채널 소유자가 운영하는 채널이 신고 또는 검토 대상이 되면 운영자는 경고, 제한, 동결, 삭제 또는 추가 확인 조치를 할 수 있습니다.",
              ],
            },
            {
              heading: "제7조 콘텐츠 및 권리",
              bullets: [
                "이용자는 자신이 게시하거나 업로드한 콘텐츠에 필요한 권리를 보유하고 있어야 합니다.",
                "이용자는 운영자가 서비스를 제공, 유지, 보안 점검, 분쟁 대응, 신고 처리, 기능 개선을 위해 필요한 범위에서 해당 콘텐츠를 저장, 복제, 전송, 표시하도록 허락합니다.",
                "운영자는 법령 준수, 서비스 운영, 권리침해 대응 또는 정책 집행을 위해 필요한 경우 콘텐츠를 검토, 제한, 삭제할 수 있습니다.",
              ],
            },
            {
              heading: "제8조 금지행위",
              bullets: [
                "타인의 권리를 침해하거나 사칭, 사기, 스팸, 악성코드 배포, 불법 홍보를 하는 행위",
                "성적 착취, 아동·청소년 유해행위, 혐오, 괴롭힘, 협박, 스토킹, 폭력 선동 등 안전을 해치는 행위",
                "비정상적인 자동화, 과도한 요청, 취약점 악용, 우회 접근, 서비스 안정성 저해 행위",
                "타인의 개인정보, 비밀번호, 인증 토큰, 비공개 채널 접근수단을 무단 수집·공유하는 행위",
                "운영자 검토, 신고, 고객지원 절차를 반복적으로 남용하거나 허위 신고를 하는 행위",
              ],
            },
            {
              heading: "제9조 신고, 운영자 조치 및 고객지원",
              bullets: [
                "이용자는 메시지, 채널 또는 운영 관련 문제를 신고하거나 고객지원 경로를 통해 문의할 수 있습니다.",
                "운영자는 신고 또는 문의 처리 과정에서 추가 정보 제출을 요청할 수 있으며, 필요 시 메시지 제한, 채널 동결, 경고 발송, 접근 제한 등의 조치를 할 수 있습니다.",
                "가이드형 고객지원 또는 1:1 지원 기록은 운영 및 분쟁 대응을 위해 일정 기간 유지될 수 있으며, 사용자 화면에서는 종료 후 더 이상 표시되지 않을 수 있습니다.",
              ],
            },
            {
              heading: "제10조 서비스 제한 및 계약 종료",
              bullets: [
                "이용자가 이 약관 또는 관련 법령을 위반하는 경우 운영자는 사전 통지 없이 일부 기능 제한, 콘텐츠 삭제, 채널 동결, 계정 정지 또는 이용계약 해지 조치를 할 수 있습니다.",
                "운영자는 보안, 안정성, 법적 의무 또는 제3자 권리 보호를 위해 긴급 조치를 우선 적용한 뒤 사후에 알릴 수 있습니다.",
                "회원은 언제든지 서비스 이용을 중단할 수 있으며, 운영자는 관련 법령이나 내부 보관 기준에 따라 필요한 정보를 보존할 수 있습니다.",
              ],
            },
            {
              heading: "제11조 면책",
              bullets: [
                "운영자는 천재지변, 통신장애, 외부 서비스 장애, 불가항력 또는 이용자 귀책사유로 인한 손해에 대해 책임을 지지 않습니다.",
                "운영자는 이용자 간 분쟁, 채널 소유자와 방문자 사이의 갈등 또는 이용자가 게시한 콘텐츠의 정확성 자체를 보증하지 않습니다.",
                "운영자는 무료로 제공되는 서비스 범위에서 법령이 허용하는 한도 내에서 책임을 제한할 수 있습니다.",
              ],
            },
            {
              heading: "제12조 준거법 및 관할",
              paragraphs: [
                "이 약관은 대한민국 법률에 따릅니다.",
                "서비스 이용과 관련하여 분쟁이 발생하는 경우 민사소송법 등 관련 법령에 따른 관할법원을 전속적 또는 합의된 관할법원으로 합니다.",
              ],
            },
            {
              heading: "제13조 문의",
              paragraphs: [
                "서비스 또는 약관 관련 문의는 운영자가 서비스 내에서 제공하는 고객지원 경로를 통해 접수할 수 있습니다.",
              ],
            },
          ],
        },
        {
          heading: "English Version",
          sections: [
            {
              heading: "Effective Date and Last Updated",
              paragraphs: [
                "Effective date: July 31, 2026",
                "Last updated: July 31, 2026",
              ],
            },
            {
              heading: "1. Purpose",
              paragraphs: [
                "These Terms of Service govern the rights, obligations, responsibilities, and conditions applicable between the individual operator of yap. (the \"Service\") and each user of the Service.",
              ],
            },
            {
              heading: "2. Definitions",
              bullets: [
                "\"User\" means any person who uses the Service, including both registered and non-registered users.",
                "\"Member\" means a user who has created an account through email login, social login, or another login method provided by the operator.",
                "\"Guest\" means a user who accesses eligible parts of the Service without creating an account, including public channels, passcode-protected channels, and guided support flows.",
                "\"Channel\" means a conversation space created in or accessed through the Service.",
                "\"Channel Owner\" means a member who creates or controls a channel and its management settings.",
                "\"Content\" means any message, image, profile asset, background, rule, report, support request, or other information uploaded or submitted through the Service.",
              ],
            },
            {
              heading: "3. Posting and Changes to the Terms",
              paragraphs: [
                "The operator will make these Terms available within the Service.",
                "The operator may amend these Terms to the extent permitted by applicable law and will provide advance notice of material changes through the Service or another reasonable method.",
                "Continued use of the Service after an amendment takes effect constitutes acceptance of the revised Terms.",
              ],
            },
            {
              heading: "4. Use of the Service",
              bullets: [
                "The Service may include anonymous or pseudonymous chat, channel creation and management, passcode-protected channels, reporting and moderation review, guided support, and one-to-one support tools.",
                "When a guest uses the Service, some access state or session continuity may depend on browser storage or access tokens issued by the Service.",
                "The operator may add, change, restrict, or discontinue features for quality, safety, or operational reasons.",
                "The Service is currently offered without a paid plan. If paid features are introduced later, separate terms or notices may apply.",
              ],
            },
            {
              heading: "5. Accounts and Access",
              bullets: [
                "Members must provide accurate information and keep their account details reasonably up to date.",
                "Each member is responsible for safeguarding their login method, authentication credentials, and device access.",
                "The operator may require additional verification, restrict access, or terminate sessions when necessary for security or in response to suspected abuse.",
              ],
            },
            {
              heading: "6. Channel Owner Responsibilities",
              bullets: [
                "A channel owner is responsible for the channel settings they control, including names, notices, welcome prompts, backgrounds, passcodes, banned words, blocking rules, and appeal settings.",
                "A channel owner must not use the Service to demand unlawful, abusive, or excessively intrusive conduct from users.",
                "If a channel becomes subject to reports or review, the operator may warn, restrict, freeze, delete, or otherwise review the channel.",
              ],
            },
            {
              heading: "7. Content and Rights",
              bullets: [
                "Each user must have the rights necessary to post or upload their content.",
                "By submitting content, the user permits the operator to store, reproduce, transmit, display, and process that content as needed to provide, secure, maintain, review, and improve the Service and to respond to disputes or reports.",
                "The operator may review, limit, or remove content when necessary for legal compliance, Service operations, rights protection, or policy enforcement.",
              ],
            },
            {
              heading: "8. Prohibited Conduct",
              bullets: [
                "Infringing rights, impersonation, fraud, spam, malware distribution, or unlawful promotion",
                "Sexual exploitation, child safety violations, hate, harassment, threats, stalking, or incitement of violence",
                "Abnormal automation, excessive requests, exploitation of vulnerabilities, bypass attempts, or conduct that harms Service stability",
                "Unauthorized collection or disclosure of personal information, passcodes, tokens, or other non-public access credentials",
                "Repeated abuse of moderation, reporting, or support channels, including knowingly false reports",
              ],
            },
            {
              heading: "9. Reports, Moderation, and Support",
              bullets: [
                "Users may report messages, channels, or operational issues and may contact support through the flows provided by the Service.",
                "The operator may request additional information and may impose message restrictions, channel freezes, warnings, or access limits where necessary.",
                "Guided support and one-to-one support records may be retained for operations and dispute handling, and closed sessions may no longer remain visible on the user's side.",
              ],
            },
            {
              heading: "10. Restrictions and Termination",
              bullets: [
                "If a user violates these Terms or applicable law, the operator may remove content, restrict features, freeze channels, suspend accounts, or terminate access without prior notice.",
                "The operator may apply urgent protective measures first and provide notice later when required for security, stability, legal compliance, or rights protection.",
                "A member may stop using the Service at any time, but the operator may retain certain records where required by law or reasonable internal retention standards.",
              ],
            },
            {
              heading: "11. Disclaimers and Limitation of Liability",
              bullets: [
                "The operator is not liable for losses caused by force majeure, telecommunications failures, third-party service failures, or causes attributable to the user.",
                "The operator does not guarantee the accuracy of user content and is not responsible for disputes between users or between channel owners and visitors.",
                "To the extent permitted by law, liability for a free service may be limited.",
              ],
            },
            {
              heading: "12. Governing Law and Venue",
              paragraphs: [
                "These Terms are governed by the laws of the Republic of Korea.",
                "Any dispute arising from or relating to the Service will be subject to the court having jurisdiction under applicable law, unless another valid forum agreement applies.",
              ],
            },
            {
              heading: "13. Contact",
              paragraphs: [
                "Questions about the Service or these Terms may be submitted through the support channel provided within the Service.",
              ],
            },
          ],
        },
      ],
    },
    en: {
      intro: "The terms below are a draft Terms of Service aligned to yap. as a personally operated project.",
      versions: [
        {
          heading: "한국어 버전",
          sections: [
            {
              heading: "시행일 및 최종 업데이트",
              paragraphs: [
                "시행일: 2026년 7월 31일",
                "최종 업데이트: 2026년 7월 31일",
              ],
            },
            {
              heading: "제1조 목적",
              paragraphs: [
                "이 약관은 개인이 운영하는 yap.(이하 \"서비스\", 해당 운영 개인은 이하 \"운영자\")와 이용자 사이의 권리, 의무, 책임사항 및 서비스 이용조건을 정하는 것을 목적으로 합니다.",
              ],
            },
            {
              heading: "제2조 정의",
              bullets: [
                "\"이용자\"는 회원과 비회원을 포함하여 이 약관에 따라 서비스를 이용하는 사람을 말합니다.",
                "\"회원\"은 이메일 또는 소셜 로그인 등 운영자가 제공하는 방식으로 계정을 만들고 로그인한 이용자를 말합니다.",
                "\"비회원\"은 계정을 만들지 않고 공개 채널, 비밀번호 채널, 가이드형 고객지원 등 서비스 일부를 이용하는 이용자를 말합니다.",
                "\"채널\"은 이용자가 만들거나 참여하는 대화 공간을 말합니다.",
                "\"채널 소유자\"는 특정 채널을 생성하거나 관리 권한을 가진 회원을 말합니다.",
                "\"콘텐츠\"는 메시지, 이미지, 채널 이름, 프로필, 배경, 규칙, 신고 내용, 고객지원 문의 등 서비스 내에 입력하거나 업로드한 모든 정보를 말합니다.",
              ],
            },
            {
              heading: "제3조 약관의 게시 및 변경",
              paragraphs: [
                "운영자는 이 약관을 서비스 내에서 확인할 수 있도록 게시합니다.",
                "운영자는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 중요한 변경이 있는 경우 서비스 화면 또는 합리적인 방법으로 사전에 알립니다.",
                "변경 후에도 서비스를 계속 이용하면 변경된 약관에 동의한 것으로 봅니다.",
              ],
            },
            {
              heading: "제4조 서비스 이용",
              bullets: [
                "서비스는 익명 또는 준익명 채팅, 채널 생성 및 관리, 비밀번호 보호 채널, 신고 및 운영자 검토, 가이드형 고객지원 및 1:1 지원 기능 등을 포함할 수 있습니다.",
                "비회원 이용 시 일부 접근 정보나 진행 상태는 브라우저 저장소 또는 서비스가 발급한 접근 토큰에 의존할 수 있습니다.",
                "운영자는 서비스 품질, 안전, 운영정책에 따라 기능을 추가, 변경, 제한 또는 종료할 수 있습니다.",
                "현재 서비스는 별도의 유료 플랜 없이 제공됩니다. 향후 유료 기능이 도입되면 별도 안내와 조건이 적용될 수 있습니다.",
              ],
            },
            {
              heading: "제5조 회원 계정 및 접근 관리",
              bullets: [
                "회원은 본인 정보를 정확하게 제공해야 하며, 계정 정보가 변경되면 지체 없이 반영해야 합니다.",
                "회원은 자신의 로그인 수단, 인증정보, 기기 접근권한을 스스로 관리해야 하며, 이를 제3자에게 공유해서는 안 됩니다.",
                "운영자는 보안상 필요하거나 비정상 사용이 의심되는 경우 추가 확인, 접근 제한 또는 세션 종료 조치를 할 수 있습니다.",
              ],
            },
            {
              heading: "제6조 채널 소유자 책임",
              bullets: [
                "채널 소유자는 채널 이름, 공지, 환영문구, 배경, 비밀번호, 금지어, 차단 및 이의제기 설정 등 자신이 관리하는 채널 구성에 대한 책임을 부담합니다.",
                "채널 소유자는 이용자에게 위법하거나 과도하게 침해적인 행위를 요구해서는 안 됩니다.",
                "채널 소유자가 운영하는 채널이 신고 또는 검토 대상이 되면 운영자는 경고, 제한, 동결, 삭제 또는 추가 확인 조치를 할 수 있습니다.",
              ],
            },
            {
              heading: "제7조 콘텐츠 및 권리",
              bullets: [
                "이용자는 자신이 게시하거나 업로드한 콘텐츠에 필요한 권리를 보유하고 있어야 합니다.",
                "이용자는 운영자가 서비스를 제공, 유지, 보안 점검, 분쟁 대응, 신고 처리, 기능 개선을 위해 필요한 범위에서 해당 콘텐츠를 저장, 복제, 전송, 표시하도록 허락합니다.",
                "운영자는 법령 준수, 서비스 운영, 권리침해 대응 또는 정책 집행을 위해 필요한 경우 콘텐츠를 검토, 제한, 삭제할 수 있습니다.",
              ],
            },
            {
              heading: "제8조 금지행위",
              bullets: [
                "타인의 권리를 침해하거나 사칭, 사기, 스팸, 악성코드 배포, 불법 홍보를 하는 행위",
                "성적 착취, 아동·청소년 유해행위, 혐오, 괴롭힘, 협박, 스토킹, 폭력 선동 등 안전을 해치는 행위",
                "비정상적인 자동화, 과도한 요청, 취약점 악용, 우회 접근, 서비스 안정성 저해 행위",
                "타인의 개인정보, 비밀번호, 인증 토큰, 비공개 채널 접근수단을 무단 수집·공유하는 행위",
                "운영자 검토, 신고, 고객지원 절차를 반복적으로 남용하거나 허위 신고를 하는 행위",
              ],
            },
            {
              heading: "제9조 신고, 운영자 조치 및 고객지원",
              bullets: [
                "이용자는 메시지, 채널 또는 운영 관련 문제를 신고하거나 고객지원 경로를 통해 문의할 수 있습니다.",
                "운영자는 신고 또는 문의 처리 과정에서 추가 정보 제출을 요청할 수 있으며, 필요 시 메시지 제한, 채널 동결, 경고 발송, 접근 제한 등의 조치를 할 수 있습니다.",
                "가이드형 고객지원 또는 1:1 지원 기록은 운영 및 분쟁 대응을 위해 일정 기간 유지될 수 있으며, 사용자 화면에서는 종료 후 더 이상 표시되지 않을 수 있습니다.",
              ],
            },
            {
              heading: "제10조 서비스 제한 및 계약 종료",
              bullets: [
                "이용자가 이 약관 또는 관련 법령을 위반하는 경우 운영자는 사전 통지 없이 일부 기능 제한, 콘텐츠 삭제, 채널 동결, 계정 정지 또는 이용계약 해지 조치를 할 수 있습니다.",
                "운영자는 보안, 안정성, 법적 의무 또는 제3자 권리 보호를 위해 긴급 조치를 우선 적용한 뒤 사후에 알릴 수 있습니다.",
                "회원은 언제든지 서비스 이용을 중단할 수 있으며, 운영자는 관련 법령이나 내부 보관 기준에 따라 필요한 정보를 보존할 수 있습니다.",
              ],
            },
            {
              heading: "제11조 면책",
              bullets: [
                "운영자는 천재지변, 통신장애, 외부 서비스 장애, 불가항력 또는 이용자 귀책사유로 인한 손해에 대해 책임을 지지 않습니다.",
                "운영자는 이용자 간 분쟁, 채널 소유자와 방문자 사이의 갈등 또는 이용자가 게시한 콘텐츠의 정확성 자체를 보증하지 않습니다.",
                "운영자는 무료로 제공되는 서비스 범위에서 법령이 허용하는 한도 내에서 책임을 제한할 수 있습니다.",
              ],
            },
            {
              heading: "제12조 준거법 및 관할",
              paragraphs: [
                "이 약관은 대한민국 법률에 따릅니다.",
                "서비스 이용과 관련하여 분쟁이 발생하는 경우 민사소송법 등 관련 법령에 따른 관할법원을 전속적 또는 합의된 관할법원으로 합니다.",
              ],
            },
            {
              heading: "제13조 문의",
              paragraphs: [
                "서비스 또는 약관 관련 문의는 운영자가 서비스 내에서 제공하는 고객지원 경로를 통해 접수할 수 있습니다.",
              ],
            },
          ],
        },
        {
          heading: "English Version",
          sections: [
            {
              heading: "Effective Date and Last Updated",
              paragraphs: [
                "Effective date: July 31, 2026",
                "Last updated: July 31, 2026",
              ],
            },
            {
              heading: "1. Purpose",
              paragraphs: [
                "These Terms of Service govern the rights, obligations, responsibilities, and conditions applicable between the individual operator of yap. (the \"Service\") and each user of the Service.",
              ],
            },
            {
              heading: "2. Definitions",
              bullets: [
                "\"User\" means any person who uses the Service, including both registered and non-registered users.",
                "\"Member\" means a user who has created an account through email login, social login, or another login method provided by the operator.",
                "\"Guest\" means a user who accesses eligible parts of the Service without creating an account, including public channels, passcode-protected channels, and guided support flows.",
                "\"Channel\" means a conversation space created in or accessed through the Service.",
                "\"Channel Owner\" means a member who creates or controls a channel and its management settings.",
                "\"Content\" means any message, image, profile asset, background, rule, report, support request, or other information uploaded or submitted through the Service.",
              ],
            },
            {
              heading: "3. Posting and Changes to the Terms",
              paragraphs: [
                "The operator will make these Terms available within the Service.",
                "The operator may amend these Terms to the extent permitted by applicable law and will provide advance notice of material changes through the Service or another reasonable method.",
                "Continued use of the Service after an amendment takes effect constitutes acceptance of the revised Terms.",
              ],
            },
            {
              heading: "4. Use of the Service",
              bullets: [
                "The Service may include anonymous or pseudonymous chat, channel creation and management, passcode-protected channels, reporting and moderation review, guided support, and one-to-one support tools.",
                "When a guest uses the Service, some access state or session continuity may depend on browser storage or access tokens issued by the Service.",
                "The operator may add, change, restrict, or discontinue features for quality, safety, or operational reasons.",
                "The Service is currently offered without a paid plan. If paid features are introduced later, separate terms or notices may apply.",
              ],
            },
            {
              heading: "5. Accounts and Access",
              bullets: [
                "Members must provide accurate information and keep their account details reasonably up to date.",
                "Each member is responsible for safeguarding their login method, authentication credentials, and device access.",
                "The operator may require additional verification, restrict access, or terminate sessions when necessary for security or in response to suspected abuse.",
              ],
            },
            {
              heading: "6. Channel Owner Responsibilities",
              bullets: [
                "A channel owner is responsible for the channel settings they control, including names, notices, welcome prompts, backgrounds, passcodes, banned words, blocking rules, and appeal settings.",
                "A channel owner must not use the Service to demand unlawful, abusive, or excessively intrusive conduct from users.",
                "If a channel becomes subject to reports or review, the operator may warn, restrict, freeze, delete, or otherwise review the channel.",
              ],
            },
            {
              heading: "7. Content and Rights",
              bullets: [
                "Each user must have the rights necessary to post or upload their content.",
                "By submitting content, the user permits the operator to store, reproduce, transmit, display, and process that content as needed to provide, secure, maintain, review, and improve the Service and to respond to disputes or reports.",
                "The operator may review, limit, or remove content when necessary for legal compliance, Service operations, rights protection, or policy enforcement.",
              ],
            },
            {
              heading: "8. Prohibited Conduct",
              bullets: [
                "Infringing rights, impersonation, fraud, spam, malware distribution, or unlawful promotion",
                "Sexual exploitation, child safety violations, hate, harassment, threats, stalking, or incitement of violence",
                "Abnormal automation, excessive requests, exploitation of vulnerabilities, bypass attempts, or conduct that harms Service stability",
                "Unauthorized collection or disclosure of personal information, passcodes, tokens, or other non-public access credentials",
                "Repeated abuse of moderation, reporting, or support channels, including knowingly false reports",
              ],
            },
            {
              heading: "9. Reports, Moderation, and Support",
              bullets: [
                "Users may report messages, channels, or operational issues and may contact support through the flows provided by the Service.",
                "The operator may request additional information and may impose message restrictions, channel freezes, warnings, or access limits where necessary.",
                "Guided support and one-to-one support records may be retained for operations and dispute handling, and closed sessions may no longer remain visible on the user's side.",
              ],
            },
            {
              heading: "10. Restrictions and Termination",
              bullets: [
                "If a user violates these Terms or applicable law, the operator may remove content, restrict features, freeze channels, suspend accounts, or terminate access without prior notice.",
                "The operator may apply urgent protective measures first and provide notice later when required for security, stability, legal compliance, or rights protection.",
                "A member may stop using the Service at any time, but the operator may retain certain records where required by law or reasonable internal retention standards.",
              ],
            },
            {
              heading: "11. Disclaimers and Limitation of Liability",
              bullets: [
                "The operator is not liable for losses caused by force majeure, telecommunications failures, third-party service failures, or causes attributable to the user.",
                "The operator does not guarantee the accuracy of user content and is not responsible for disputes between users or between channel owners and visitors.",
                "To the extent permitted by law, liability for a free service may be limited.",
              ],
            },
            {
              heading: "12. Governing Law and Venue",
              paragraphs: [
                "These Terms are governed by the laws of the Republic of Korea.",
                "Any dispute arising from or relating to the Service will be subject to the court having jurisdiction under applicable law, unless another valid forum agreement applies.",
              ],
            },
            {
              heading: "13. Contact",
              paragraphs: [
                "Questions about the Service or these Terms may be submitted through the support channel provided within the Service.",
              ],
            },
          ],
        },
      ],
    },
  },
};
