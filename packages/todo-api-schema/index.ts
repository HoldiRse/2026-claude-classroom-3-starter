import { z } from "zod";

/**
 * The wire contract of /api/todos, shared by the route handlers and the
 * `ai-tutor` CLI. Depends on zod alone, so a client can import it without
 * pulling in the database or the auth instance. The tutor's tools use
 * `todoSchema` too, so the agent and the API report the same item shape.
 */

/**
 * The `client_id` the CLI sends through Better Auth's device authorization
 * flow; the server's `validateClient` accepts no other.
 */
export const CLI_CLIENT_ID = "ai-tutor-cli";

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});
export type Todo = z.infer<typeof todoSchema>;

/** `GET /api/todos?q=milk` — `q` keeps items whose title contains it, ignoring case. */
export const listTodosQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
});
export type ListTodosQuery = z.infer<typeof listTodosQuerySchema>;

export const listTodosResponseSchema = z.object({
  todos: z.array(todoSchema),
});
export type ListTodosResponse = z.infer<typeof listTodosResponseSchema>;

/** `POST /api/todos` — answers 201 with the new item. */
export const createTodoRequestSchema = z.object({
  title: z.string().trim().min(1),
});
export type CreateTodoRequest = z.infer<typeof createTodoRequestSchema>;

/** `PATCH /api/todos/{id}` — `done: false` reopens the item. */
export const updateTodoRequestSchema = z.object({
  done: z.boolean(),
});
export type UpdateTodoRequest = z.infer<typeof updateTodoRequestSchema>;

/** The body of a 201 from POST and a 200 from PATCH. */
export const todoResponseSchema = z.object({
  todo: todoSchema,
});
export type TodoResponse = z.infer<typeof todoResponseSchema>;

/**
 * Every non-2xx body: 400 `invalid_request` (with zod's issues), 401
 * `unauthorized`, 404 `not_found`.
 */
export const errorResponseSchema = z.object({
  error: z.enum(["invalid_request", "unauthorized", "not_found"]),
  issues: z
    .array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    )
    .optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
