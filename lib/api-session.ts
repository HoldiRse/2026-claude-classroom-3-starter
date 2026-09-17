import "server-only";
import type { ErrorResponse } from "@ai-tutor/todo-api-schema";
import type { z } from "zod";
import { auth } from "@/lib/auth";

/**
 * The session behind a /api/todos request. Reads accept the browser's cookie
 * as well as a bearer token, because the sidebar fetches the list. Writes pass
 * Better Auth the `Authorization` header alone, so a cookie a browser attaches
 * on its own can never authorize one.
 */
export function apiSession(
  request: Request,
  { allowCookie }: { allowCookie: boolean },
) {
  if (allowCookie) {
    return auth.api.getSession({ headers: request.headers });
  }

  const authorization = request.headers.get("authorization");
  return authorization
    ? auth.api.getSession({ headers: new Headers({ authorization }) })
    : null;
}

export const errorResponse = (
  status: 400 | 401 | 404,
  error: ErrorResponse["error"],
  issues?: z.core.$ZodIssue[],
) =>
  Response.json(
    {
      error,
      issues: issues?.map(({ path, message }) => ({
        path: path.map((key) => (typeof key === "symbol" ? String(key) : key)),
        message,
      })),
    } satisfies ErrorResponse,
    { status },
  );

/** Parses a JSON body against `schema`; malformed JSON fails like a bad shape. */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
) {
  const body: unknown = await request.json().catch(() => undefined);
  return schema.safeParse(body);
}
