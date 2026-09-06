import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    isPlatformAdmin?: boolean;
  }

  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      isPlatformAdmin?: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    identityVersion?: number;
    isPlatformAdmin?: boolean;
  }
}
