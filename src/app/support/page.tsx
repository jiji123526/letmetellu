import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PlatformSupportThreadPanel } from "@/components/support/PlatformSupportThreadPanel";
import { SupportPanel } from "@/components/support/SupportPanel";

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/dashboard?login=true");
  }

  const params = await searchParams;
  const threadParam = Array.isArray(params.thread) ? params.thread[0] : params.thread;

  if (typeof threadParam === "string" && threadParam) {
    return <PlatformSupportThreadPanel threadId={threadParam} />;
  }

  return <SupportPanel />;
}
