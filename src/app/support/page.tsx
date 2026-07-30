import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SupportPanel } from "@/components/support/SupportPanel";

export default async function SupportPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/dashboard?login=true");
  }

  return <SupportPanel />;
}
