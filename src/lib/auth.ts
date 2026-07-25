import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "http://localhost:8787";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Verify against Worker
        const res = await fetch(`${WORKER_URL}/api/auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
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
    signIn: "/login",
  },
});
