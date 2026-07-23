import { redirect } from "next/navigation";

export default function Home() {
  // TODO: Check auth session, redirect to dashboard if logged in
  redirect("/login");
}
