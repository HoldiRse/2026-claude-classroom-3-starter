import { CLI_CLIENT_ID } from "@ai-tutor/todo-api-schema";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { BetterAuthOptions } from "better-auth";
import type { DeviceAuthorizationPluginOptions } from "better-auth/plugins";
import * as schema from "@/lib/schema";

type DrizzleDb = Parameters<typeof drizzleAdapter>[0];

/**
 * Everything about the auth instance except the plugins, which each entry point
 * spreads in as a static array — Better Auth only infers plugin helpers (such as
 * `ctx.test`) from literal arrays. Kept free of the `server-only` marker in
 * lib/db.ts so the Better Auth CLI and the Vitest suite can load it.
 */
export function authOptions(db: DrizzleDb) {
  return {
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true },
  } satisfies BetterAuthOptions;
}

/**
 * `deviceAuthorization(deviceAuthorizationOptions)` belongs in every entry
 * point's plugin array, the CLI one included, so `auth:generate` sees its
 * table. Codes are approved on app/device, and only the `ai-tutor` CLI may ask.
 */
export const deviceAuthorizationOptions = {
  verificationUri: "/device",
  validateClient: (clientId) => clientId === CLI_CLIENT_ID,
} satisfies DeviceAuthorizationPluginOptions;
