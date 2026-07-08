import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/brokers/rate-limit";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// Hash of a throwaway string, compared against when the email doesn't
// exist (or the account is Google-only with no local password) — those
// paths then cost the same wall-clock as "wrong password", killing the
// timing oracle for account enumeration.
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-password", 12);

/** Google login is optional — enabled only when OAuth creds are configured. */
export const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.trim().toLowerCase();

        // Brute-force guard: 10 attempts / 15 minutes per email. Keyed on
        // the email (not IP) so a distributed guess against one account is
        // still throttled; successful logins are rare enough that the
        // shared budget is invisible to legitimate users.
        if (!rateLimit(`login:${email}`, 10, 15 * 60_000)) {
          return null;
        }

        const user = await db.user.findUnique({ where: { email } });

        // Google-only accounts (passwordHash null) cannot use password
        // login — they fall through to the dummy compare and fail without
        // revealing why.
        const ok = await bcrypt.compare(
          parsed.data.password,
          user?.passwordHash ?? DUMMY_HASH,
        );
        if (!user || !user.passwordHash || !ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
        };
      },
    }),
    // Registered even when unconfigured (NextAuth requires a static list);
    // the login UI hides the button and Google would reject the handshake.
    Google,
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;
      const existing = await db.user.findUnique({ where: { email } });

      // Account-takeover guard: registration does NOT verify email
      // ownership, so a pre-existing PASSWORD account for this mailbox may
      // have been created by someone who doesn't own the inbox. Auto-
      // linking Google into it would hand the real Google owner an
      // attacker-controlled account (which still has password access).
      // Refuse; the owner can link Google later from inside Settings once
      // authenticated. A Google-only account (no passwordHash) is our own
      // prior Google signup → safe to sign back into.
      if (existing && existing.passwordHash) {
        return "/login?error=use_password";
      }

      if (!existing) {
        const created = await db.user.create({
          data: {
            email,
            name: user.name ?? email.split("@")[0],
            passwordHash: null,
          },
          select: { id: true },
        });
        // Google signups accept the Terms via the notice under the button;
        // record it the same way the register form does.
        await db.appSetting.create({
          data: {
            userId: created.id,
            key: "legal:tos-accepted",
            value: {
              at: new Date().toISOString(),
              version: "2026-07-07",
              via: "google",
            },
          },
        });
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user && account?.provider === "google") {
        // user.id here is Google's subject — swap in OUR DB id.
        const email = user.email?.trim().toLowerCase();
        if (email) {
          const dbUser = await db.user.findUnique({
            where: { email },
            select: { id: true },
          });
          if (dbUser) token.id = dbUser.id;
        }
      } else if (user) {
        token.id = (user as { id: string }).id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
