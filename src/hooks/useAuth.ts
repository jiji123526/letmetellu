"use client";

import { useSession } from "next-auth/react";

export function useAuth(channelOwnerUid?: string) {
  const { data: session, status } = useSession();

  const isLoggedIn = status === "authenticated";
  const userId = session?.user?.id || null;
  const isOwner = !!(userId && channelOwnerUid && userId === channelOwnerUid);

  return {
    session,
    status,
    isLoggedIn,
    userId,
    isOwner,
  };
}
