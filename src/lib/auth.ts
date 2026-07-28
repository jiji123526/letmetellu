import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
const IDENTITY_VERSION = 1;
type UserSyncFlow = "login" | "signup" | "sync";

async function syncUserIdentity(user: {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  flow: UserSyncFlow;
}) {
  const response = await fetch(`${WORKER_URL}/api/user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": process.env.INTERNAL_SECRET || "",
    },
    body: JSON.stringify(user),
    cache: "no-store",
  });
  const data = await response.json() as { user_id?: string; error?: string };
  if (!response.ok || !data.user_id) {
    throw new Error(data.error || "user identity sync failed");
  }
  return data.user_id;
}

function oauthErrorRedirect(flow: UserSyncFlow, error?: string) {
  if (flow === "signup") {
    return error === "account_exists"
      ? "/dashboard?error=oauth_signup_exists"
      : "/dashboard?error=oauth_signup";
  }
  return "/dashboard?error=oauth_login";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      id: "google-login",
      name: "Google",
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Google({
      id: "google-signup",
      name: "Google",
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;

        // Verify against Worker
        const res = await fetch(`${WORKER_URL}/api/auth`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Token": process.env.INTERNAL_SECRET || "",
            "X-Client-IP": request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
          },
          body: JSON.stringify({
            action: "login",
            email: credentials.email,
            password: credentials.password,
          }),
        });

        const data = await res.json() as { ok?: boolean; id?: string; email?: string; name?: string; error?: string };
        if (!data.ok || !data.id) return null;

        return {
          id: data.id,
          email: data.email,
          name: data.name,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile, user }) {
      const googleFlow = account?.provider === "google-signup"
        ? "signup"
        : account?.provider === "google-login"
          ? "login"
          : null;
      if (!googleFlow) return true;
      if (
        profile?.email_verified !== true
        || typeof profile.email !== "string"
        || typeof user.id !== "string"
      ) {
        return oauthErrorRedirect(googleFlow);
      }
      try {
        user.id = await syncUserIdentity({
          id: user.id,
          email: profile.email,
          name: user.name,
          image: user.image,
          flow: googleFlow,
        });
        return true;
      } catch (error) {
        return oauthErrorRedirect(googleFlow, error instanceof Error ? error.message : undefined);
      }
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.identityVersion = IDENTITY_VERSION;
      }
      const sourceId = token.id || token.sub;
      const email = token.email;
      if (!user && sourceId && email && token.identityVersion !== IDENTITY_VERSION) {
        try {
          token.id = await syncUserIdentity({
            id: sourceId as string,
            email,
            name: token.name,
            image: typeof token.picture === "string" ? token.picture : null,
            flow: "sync",
          });
          token.identityVersion = IDENTITY_VERSION;
        } catch {}
      }
      // Auth.js stores the provider/credentials user ID in the standard `sub`
      // claim. Keep using it as a fallback so sessions created without the
      // custom `id` claim still receive a stable application user ID.
      if (!token.id && token.sub) {
        token.id = token.sub;
      }
      return token;
    },
    async session({ session, token }) {
      const userId = token.id ?? token.sub;
      if (session.user && userId) {
        session.user.id = userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/dashboard",
    error: "/dashboard",
  },
});
