import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";
const IDENTITY_VERSION = 1;

async function syncUserIdentity(user: {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
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

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
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
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      return profile?.email_verified === true && typeof profile.email === "string";
    },
    async jwt({ token, user }) {
      const sourceId = user?.id || token.id || token.sub;
      const email = user?.email || token.email;
      if (sourceId && email && (user || token.identityVersion !== IDENTITY_VERSION)) {
        try {
          token.id = await syncUserIdentity({
            id: sourceId as string,
            email,
            name: user?.name || token.name,
            image: user?.image || token.picture,
          });
          token.identityVersion = IDENTITY_VERSION;
        } catch (error) {
          // Abort a new sign-in rather than issue a session with an identity
          // that cannot own or retrieve its channels.
          if (user) throw error;
        }
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
    signIn: "/dashboard?login=true",
  },
});
