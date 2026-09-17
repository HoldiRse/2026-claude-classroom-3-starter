import {
  createTodoRequestSchema,
  type ListTodosResponse,
  listTodosQuerySchema,
  type TodoResponse,
} from "@ai-tutor/todo-api-schema";
import { apiSession, errorResponse, parseJsonBody } from "@/lib/api-session";
import { db } from "@/lib/db";
import { addTodoFor, listTodosFor } from "@/lib/todo-tools";

/**
 * The list, for CLIs over a bearer token and for the sidebar over its cookie.
 * Same query the `listTodos` tool runs, on the session-derived user id.
 */
export async function GET(request: Request) {
  const session = await apiSession(request, { allowCookie: true });
  if (!session) {
    return errorResponse(401, "unauthorized");
  }

  const query = listTodosQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return errorResponse(400, "invalid_request", query.error.issues);
  }

  const todos = await listTodosFor(db, session.user.id, {
    query: query.data.q,
  });
  return Response.json({ todos } satisfies ListTodosResponse);
}

/** Bearer only: the browser's write path is the agent. */
export async function POST(request: Request) {
  const session = await apiSession(request, { allowCookie: false });
  if (!session) {
    return errorResponse(401, "unauthorized");
  }

  const body = await parseJsonBody(request, createTodoRequestSchema);
  if (!body.success) {
    return errorResponse(400, "invalid_request", body.error.issues);
  }

  const todo = await addTodoFor(db, session.user.id, body.data.title);
  return Response.json({ todo } satisfies TodoResponse, { status: 201 });
}
