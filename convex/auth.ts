import { Email } from "@convex-dev/auth/providers/Email";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { Value } from "convex/values";

import { sendSignInEmail } from "./authEmail";

/**
 * Sign-in, by email link *or* by password.
 *
 * Two providers, deliberately: the magic link stays as the recovery path for
 * someone who forgets a password, and it is the only one that needs outbound
 * mail. Neither can be used to take over the other — they are separate accounts
 * on the same user row, and Convex Auth matches on the provider account.
 *
 * `Email`'s default `authorize` requires the verification call to carry the same
 * address that started the sign-in, so a leaked token cannot be redeemed against
 * a different account. That check is left in place: it is the reason this
 * provider is safe to use with a link that travels by email. The link expires in
 * one hour (the provider's default), which is also what the message text says.
 *
 * `Password` keeps the library's own validation (non-empty, at least 8
 * characters) and hashing rather than rolling either by hand.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      async sendVerificationRequest({ identifier, url, token }) {
        await sendSignInEmail({ to: identifier, url, token });
      },
    }),
    Password({
      /**
       * Runs for every flow, so `name` is only present on sign-up. It is read
       * from the submitted params and never from anything the client asserts
       * about an existing account.
       */
      profile(params) {
        // `undefined` is not a Convex value, so the name is only included when
        // it was actually submitted — otherwise the row is written with the key
        // present and no value, which fails validation.
        const email = params.email as string;
        const name = params.name as string | undefined;

        // `undefined` is not a Convex value, so the key is added only when a
        // name was submitted rather than written as a present-but-empty field.
        const profile: Record<string, Value> & { email: string } = { email };
        if (name !== undefined) profile.name = name;
        return profile;
      },
    }),
  ],
});
