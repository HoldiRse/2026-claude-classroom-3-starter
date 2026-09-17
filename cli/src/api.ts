import {
  createTodoRequestSchema,
  errorResponseSchema,
  listTodosQuerySchema,
  listTodosResponseSchema,
  type Todo,
  todoResponseSchema,
  updateTodoRequestSchema,
} from "@ai-tutor/todo-api-schema";
import type { z } from "zod";
import { CliError, NotLoggedInError } from "./errors";

type Request<T extends z.ZodType> = {
  server: string;
  token: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  schema: T;
  body?: unknown;
  /** The message for a 404, which only the item routes can answer. */
  notFound?: string;
};

/**
 * One request against /api/todos with the stored session token as a bearer,
 * decoded through the shared response schemas so a changed contract fails here
 * rather than halfway through formatting.
 */
async function request<T extends z.ZodType>({
  server,
  token,
  method,
  path,
  schema,
  body,
  notFound,
}: Request<T>): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(`${server}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new CliError(
      `cannot reach ${server} (${(error as Error).message}) — is the app running? Set AI_TUTOR_SERVER to point somewhere else.`,
    );
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (response.ok) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new CliError(`${server} answered ${path} in an unexpected shape`);
    }
    return parsed.data;
  }

  if (response.status === 401) {
    throw new NotLoggedInError(
      `the session token for ${server} was rejected — run \`ai-tutor login\``,
    );
  }
  if (response.status === 404 && notFound) {
    throw new CliError(notFound);
  }

  const error = errorResponseSchema.safeParse(payload);
  const issues = error.success
    ? error.data.issues?.map((issue) => issue.message).join("; ")
    : undefined;
  throw new CliError(
    `${method} ${path} failed (${response.status}${issues ? `: ${issues}` : ""})`,
  );
}

export async function listTodos(
  server: string,
  token: string,
  query?: string,
): Promise<Todo[]> {
  const parsed = listTodosQuerySchema.safeParse(query ? { q: query } : {});
  if (!parsed.success) {
    throw new CliError("--query needs some text to match");
  }

  const search = parsed.data.q
    ? `?${new URLSearchParams({ q: parsed.data.q })}`
    : "";
  const { todos } = await request({
    server,
    token,
    method: "GET",
    path: `/api/todos${search}`,
    schema: listTodosResponseSchema,
  });
  return todos;
}

export async function addTodo(
  server: string,
  token: string,
  title: string,
): Promise<Todo> {
  const parsed = createTodoRequestSchema.safeParse({ title });
  if (!parsed.success) {
    throw new CliError("a todo needs a title");
  }

  const { todo } = await request({
    server,
    token,
    method: "POST",
    path: "/api/todos",
    schema: todoResponseSchema,
    body: parsed.data,
  });
  return todo;
}

export async function setTodoDone(
  server: string,
  token: string,
  id: string,
  done: boolean,
): Promise<Todo> {
  const { todo } = await request({
    server,
    token,
    method: "PATCH",
    path: `/api/todos/${encodeURIComponent(id)}`,
    schema: todoResponseSchema,
    body: updateTodoRequestSchema.parse({ done }),
    notFound: `no todo with id ${id} on your list`,
  });
  return todo;
}
