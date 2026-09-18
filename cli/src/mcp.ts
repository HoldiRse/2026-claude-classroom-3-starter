import {
  createTodoRequestSchema,
  listTodosQuerySchema,
  listTodosResponseSchema,
  type Todo,
  todoIdParamSchema,
  todoResponseSchema,
} from "@ai-tutor/todo-api-schema";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import packageJson from "../package.json" with { type: "json" };
import { addTodo, listTodos, setTodoDone } from "./api";
import { readToken, serverUrl } from "./config";
import { NotLoggedInError } from "./errors";

/**
 * The same commands `ai-tutor` offers a person, offered to an MCP client over
 * stdio: one tool per command, the shared zod contract as their input schemas,
 * and the stored session token as their credential. stdout belongs to the
 * protocol here, so nothing in this file may print.
 */

/** Both halves of a result: the text a client shows, and the typed payload. */
const result = (text: string, structuredContent: object): CallToolResult => ({
  content: [{ type: "text", text }],
  structuredContent,
});

/**
 * Tool errors are results rather than throws, so the model reads them and can
 * act on them — which for a missing token means telling the user to sign in.
 */
const failed = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const formatTodo = (todo: Todo) =>
  `${todo.done ? "[x]" : "[ ]"} ${todo.id}  ${todo.title}`;

/**
 * Read per call, not once at startup: the server has to start without a login
 * so a client can register it, and a `ai-tutor login` in another terminal then
 * takes effect without restarting it.
 */
async function requireToken(server: string): Promise<string> {
  const token = await readToken(server);
  if (!token) {
    throw new NotLoggedInError(
      `not signed in to ${server} — run \`ai-tutor login\` in a terminal and approve the code in the browser, then try again`,
    );
  }
  return token;
}

/** Every tool body: the failures the CLI prints become `isError` results. */
async function run(body: () => Promise<CallToolResult>) {
  try {
    return await body();
  } catch (error) {
    return failed((error as Error).message);
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "ai-tutor", version: packageJson.version },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "list_todos",
    {
      title: "List to-dos",
      description:
        "List the signed-in user's to-dos, done ones included. Each item carries the id that mark_todo_done takes.",
      inputSchema: listTodosQuerySchema,
      outputSchema: listTodosResponseSchema,
      annotations: { readOnlyHint: true },
    },
    ({ q }) =>
      run(async () => {
        const server = serverUrl();
        const todos = await listTodos(server, await requireToken(server), q);
        const text =
          todos.length === 0
            ? q
              ? `Nothing matches "${q}".`
              : "Nothing on the list yet."
            : todos.map(formatTodo).join("\n");
        return result(text, { todos });
      }),
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add a to-do",
      description: "Put a new item on the signed-in user's to-do list.",
      inputSchema: createTodoRequestSchema,
      outputSchema: todoResponseSchema,
      annotations: { idempotentHint: false },
    },
    ({ title }) =>
      run(async () => {
        const server = serverUrl();
        const todo = await addTodo(server, await requireToken(server), title);
        return result(`Added ${formatTodo(todo)}`, { todo });
      }),
  );

  server.registerTool(
    "mark_todo_done",
    {
      title: "Mark a to-do done",
      description:
        "Tick off one item by the id list_todos reports for it. Ticking off an item that is already done changes nothing.",
      inputSchema: todoIdParamSchema,
      outputSchema: todoResponseSchema,
      annotations: { idempotentHint: true },
    },
    ({ id }) =>
      run(async () => {
        const server = serverUrl();
        const todo = await setTodoDone(
          server,
          await requireToken(server),
          id,
          true,
        );
        return result(`Done ${formatTodo(todo)}`, { todo });
      }),
  );

  return server;
}

/** Serves until the client closes stdin, which ends the process with it. */
export function serveMcpOverStdio() {
  return serveStdio(createMcpServer);
}
