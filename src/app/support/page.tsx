import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PlatformSupportThreadPanel } from "@/components/support/PlatformSupportThreadPanel";
import { SupportPanel } from "@/components/support/SupportPanel";

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string | string[]; admin?: string | string[] }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const threadParam = Array.isArray(params.thread) ? params.thread[0] : params.thread;
  const adminParam = Array.isArray(params.admin) ? params.admin[0] : params.admin;

  if (typeof threadParam === "string" && threadParam && adminParam === "1") {
    if (!session?.user?.id) {
      redirect("/dashboard?login=true");
    }
    return <PlatformSupportThreadPanel threadId={threadParam} />;
  }

  return <SupportPanel showThreadView={typeof threadParam === "string" && !!threadParam} />;
}
