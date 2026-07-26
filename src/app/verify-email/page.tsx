import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify email · Let Me Tell U",
  referrer: "no-referrer",
};

function VerificationResult({ verified }: { verified: boolean }) {
  const appOrigin = (
    process.env.APP_ORIGIN
    || process.env.NEXT_PUBLIC_APP_ORIGIN
    || "https://letmetellu.vercel.app"
  ).replace(/\/+$/, "");
  const loginUrl = `${appOrigin}/dashboard?login=true${verified ? "&verified=true" : ""}`;

  return (
    <main
      className="min-h-dvh flex items-center justify-center p-5"
      style={{ background: "#f2f2f7", color: "#111" }}
    >
      <section
        className="w-full max-w-[390px] rounded-[24px] px-6 py-7 text-center"
        style={{ background: "#fff", boxShadow: "0 18px 55px rgba(0,0,0,.12)" }}
      >
        <div
          className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center text-[24px] font-semibold"
          style={{
            background: verified ? "#eaf8ef" : "#fff0ef",
            color: verified ? "#2a9d4e" : "#ff3b30",
          }}
        >
          {verified ? "✓" : "!"}
        </div>
        <h1 className="m-0 text-[22px] font-bold">
          {verified ? "이메일 인증이 완료되었습니다" : "인증 링크를 확인할 수 없습니다"}
        </h1>
        <p className="mt-2 mb-6 text-[14px] leading-[1.55]" style={{ color: "#6d6d72" }}>
          {verified
            ? "아래 버튼을 눌러 브라우저에서 로그인해 주세요."
            : "링크가 만료되었거나 올바르지 않습니다. 로그인 화면에서 인증 메일을 다시 요청해 주세요."}
        </p>
        <a
          href={loginUrl}
          target="_top"
          className="block w-full rounded-[12px] py-3 text-white text-[15px] font-semibold no-underline"
          style={{ background: "#007aff" }}
        >
          로그인 화면 열기
        </a>
        <p className="mt-3 mb-0 text-[12px] leading-[1.45]" style={{ color: "#8e8e93" }}>
          Open the login page in your browser.
        </p>
      </section>
    </main>
  );
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const tokenValue = (await searchParams).token;
  const token = typeof tokenValue === "string" ? tokenValue : "";
  let verified = false;

  if (token) {
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
    try {
      const response = await fetch(`${workerUrl}/api/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": process.env.INTERNAL_SECRET || "",
        },
        body: JSON.stringify({ action: "verify-email", token }),
        cache: "no-store",
      });
      const data = await response.json() as { ok?: boolean };
      if (response.ok && data.ok) {
        verified = true;
      }
    } catch {}
  }

  return <VerificationResult verified={verified} />;
}
