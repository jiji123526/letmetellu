import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PlatformSupportInbox } from "@/components/support/PlatformSupportInbox";

export default async function PlatformSupportPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/dashboard?login=true");
  }

  return <PlatformSupportInbox />;
}
