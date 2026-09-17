import { CLI_CLIENT_ID } from "@ai-tutor/todo-api-schema";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { CliError } from "./errors";

/**
 * Better Auth's own client, so the device flow and the session lookup speak
 * exactly the endpoints the server mounts under /api/auth.
 */
const authClient = (server: string) =>
  createAuthClient({
    baseURL: `${server}/api/auth`,
    plugins: [deviceAuthorizationClient()],
  });

const bearer = (token: string) => ({
  fetchOptions: { headers: { authorization: `Bearer ${token}` } },
});

/** better-fetch reports a failed request as a value, a dead server as a throw. */
const unreachable = (server: string, error: unknown) =>
  new CliError(
    `cannot reach ${server} (${(error as Error).message}) — is the app running? Set AI_TUTOR_SERVER to point somewhere else.`,
  );

/** The device flow's error codes arrive as `{ error, error_description }`. */
const errorCode = (error: unknown) =>
  typeof error === "object" && error !== null && "error" in error
    ? String((error as { error: unknown }).error)
    : undefined;

const errorMessage = (error: unknown) =>
  typeof error === "object" && error !== null
    ? String(
        (error as { error_description?: unknown; message?: unknown })
          .error_description ??
          (error as { message?: unknown }).message ??
          "unknown error",
      )
    : "unknown error";

export type SessionUser = { id: string; name: string; email: string };

/** `undefined` when the token has expired or been revoked. */
export async function fetchUser(
  server: string,
  token: string,
): Promise<SessionUser | undefined> {
  try {
    const { data, error } = await authClient(server).getSession(bearer(token));
    if (error) {
      if (error.status === 401) return undefined;
      throw new CliError(`${server} rejected the session lookup`);
    }
    return data?.user;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw unreachable(server, error);
  }
}

export type DeviceRequest = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** Seconds between polls, as the server asks. */
  interval: number;
  expiresAt: number;
};

/** Step one of RFC 8628: ask for the pair of codes the user will approve. */
export async function requestDeviceCode(
  server: string,
): Promise<DeviceRequest> {
  let result: Awaited<
    ReturnType<ReturnType<typeof authClient>["device"]["code"]>
  >;
  try {
    result = await authClient(server).device.code({ client_id: CLI_CLIENT_ID });
  } catch (error) {
    throw unreachable(server, error);
  }

  const { data, error } = result;
  if (error || !data) {
    throw new CliError(
      `${server} refused to start the sign-in (${errorMessage(error)})`,
    );
  }

  const expiresIn = data.expires_in ?? 600;
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    interval: data.interval ?? 5,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Step two: poll until the user approves on the verification page. Returns the
 * session token, which is the only thing the caller ever stores.
 */
export async function pollForToken(
  server: string,
  request: DeviceRequest,
): Promise<string> {
  let interval = request.interval;

  while (Date.now() < request.expiresAt) {
    await sleep(interval * 1000);

    let result: Awaited<
      ReturnType<ReturnType<typeof authClient>["device"]["token"]>
    >;
    try {
      result = await authClient(server).device.token({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: request.deviceCode,
        client_id: CLI_CLIENT_ID,
      });
    } catch (error) {
      throw unreachable(server, error);
    }

    const token = result.data?.access_token;
    if (token) return token;

    switch (errorCode(result.error)) {
      case "authorization_pending":
        break;
      case "slow_down":
        interval += 5;
        break;
      case "access_denied":
        throw new CliError("the sign-in was denied in the browser");
      case "expired_token":
        throw new CliError(
          "the code expired before it was approved — run `ai-tutor login` again",
        );
      default:
        throw new CliError(
          `the sign-in failed (${errorMessage(result.error)})`,
        );
    }
  }

  throw new CliError(
    "the code expired before it was approved — run `ai-tutor login` again",
  );
}

/** Revokes the session behind the token, so logout is not merely local. */
export async function revokeToken(
  server: string,
  token: string,
): Promise<void> {
  try {
    const { error } = await authClient(server).signOut(bearer(token));
    if (error && error.status !== 401) {
      throw new CliError(`${server} refused to revoke the session`);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw unreachable(server, error);
  }
}
