import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { authOptions, deviceAuthorizationOptions } from "@/lib/auth-config";
import { db } from "@/lib/db";

export const auth = betterAuth({
  ...authOptions(db),
  plugins: [
    // Lets CLIs send the session token as `Authorization: Bearer`; sign-in
    // returns it in the `set-auth-token` header. No schema of its own.
    bearer(),
    // `ai-tutor login`: the CLI polls for a session token while a signed-in
    // user approves its code on /device.
    deviceAuthorization(deviceAuthorizationOptions),
    // nextCookies mirrors Set-Cookie into next/headers, so it must stay last.
    nextCookies(),
  ],
});
