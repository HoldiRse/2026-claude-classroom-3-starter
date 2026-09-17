import {
  type TodoResponse,
  updateTodoRequestSchema,
} from "@ai-tutor/todo-api-schema";
import { apiSession, errorResponse, parseJsonBody } from "@/lib/api-session";
import { db } from "@/lib/db";
import { setTodoDoneFor } from "@/lib/todo-tools";

/** Bearer only, like POST. Another user's id answers 404, as a missing one does. */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/todos/[id]">,
) {
  const session = await apiSession(request, { allowCookie: false });
  if (!session) {
    return errorResponse(401, "unauthorized");
  }

  const body = await parseJsonBody(request, updateTodoRequestSchema);
  if (!body.success) {
    return errorResponse(400, "invalid_request", body.error.issues);
  }

  const { id } = await ctx.params;
  const todo = await setTodoDoneFor(db, session.user.id, id, body.data.done);
  if (!todo) {
    return errorResponse(404, "not_found");
  }

  return Response.json({ todo } satisfies TodoResponse);
}
