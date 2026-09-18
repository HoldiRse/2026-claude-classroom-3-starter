import {
  listTodosResponseSchema,
  todoResponseSchema,
} from "@ai-tutor/todo-api-schema";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, test } from "vitest";
import { cliBin, startTodoServer, type TodoServer } from "./todo-server";

/**
 * `ai-tutor mcp --stdio` as a client sees it: a real MCP client spawns the
 * built CLI and drives the todo tools over the protocol, against the same test
 * server the CLI suite uses. The one connection outlives the sign-in, because
 * the tools read the stored token per call.
 */

let app: TodoServer;
let client: Client;

beforeAll(async () => {
  app = await startTodoServer({ distDir: ".next-mcp" });

  client = new Client({ name: "mcp-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cliBin, "mcp", "--stdio"],
      env: app.cliEnv(),
    }),
  );
}, 180_000);

afterAll(async () => {
  await client?.close();
  await app?.stop();
});

const text = (result: CallToolResult) =>
  result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

const call = (name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

let todoId: string;

test("the server starts without a login and offers the todo tools", async () => {
  const { tools } = await client.listTools();

  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "add_todo",
    "list_todos",
    "mark_todo_done",
  ]);

  // The schemas come from the shared contract, so the filter and the title
  // arrive at the client the way the API documents them.
  const list = tools.find((tool) => tool.name === "list_todos");
  expect(list?.inputSchema.properties).toHaveProperty("q");
  expect(list?.inputSchema.required).toBeUndefined();

  const add = tools.find((tool) => tool.name === "add_todo");
  expect(add?.inputSchema.required).toEqual(["title"]);
});

test("every tool tells the user to sign in while there is no token", async () => {
  for (const [name, args] of [
    ["list_todos", {}],
    ["add_todo", { title: "Buy oat milk" }],
    ["mark_todo_done", { id: "whatever" }],
  ] as const) {
    const result = await call(name, args);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("ai-tutor login");
  }
});

test("add_todo puts an item on the list once signed in", async () => {
  expect((await app.loginCli()).code).toBe(0);

  const result = await call("add_todo", { title: "Buy oat milk" });
  expect(result.isError).toBeFalsy();

  const { todo } = todoResponseSchema.parse(result.structuredContent);
  expect(todo).toMatchObject({ title: "Buy oat milk", done: false });
  expect(text(result)).toContain(`Added [ ] ${todo.id}  Buy oat milk`);
  todoId = todo.id;

  expect(
    (await call("add_todo", { title: "Write the migration" })).isError,
  ).toBeFalsy();
});

test("list_todos lists everything, and its filter narrows it", async () => {
  const listed = await call("list_todos");
  const { todos } = listTodosResponseSchema.parse(listed.structuredContent);
  expect(todos.map((todo) => todo.title)).toEqual([
    "Buy oat milk",
    "Write the migration",
  ]);
  expect(text(listed)).toContain(`[ ] ${todoId}  Buy oat milk`);

  const filtered = await call("list_todos", { q: "OAT" });
  expect(listTodosResponseSchema.parse(filtered.structuredContent)).toEqual({
    todos: [{ id: todoId, title: "Buy oat milk", done: false }],
  });

  const unmatched = await call("list_todos", { q: "bicycle" });
  expect(text(unmatched)).toContain('Nothing matches "bicycle".');
});

test("mark_todo_done ticks the item off, and list_todos agrees", async () => {
  const done = await call("mark_todo_done", { id: todoId });
  expect(done.isError).toBeFalsy();
  expect(todoResponseSchema.parse(done.structuredContent).todo).toEqual({
    id: todoId,
    title: "Buy oat milk",
    done: true,
  });

  const listed = await call("list_todos", { q: "oat" });
  const { todos } = listTodosResponseSchema.parse(listed.structuredContent);
  expect(todos).toEqual([{ id: todoId, title: "Buy oat milk", done: true }]);

  const missing = await call("mark_todo_done", { id: "not-an-id" });
  expect(missing.isError).toBe(true);
  expect(text(missing)).toContain("no todo with id not-an-id");
});

test("a rejected argument comes back as an error, not a crash", async () => {
  const empty = await call("add_todo", { title: "   " });
  expect(empty.isError).toBe(true);

  // The connection survived all of it, which is the proof that nothing but
  // protocol was ever written to stdout.
  expect((await client.listTools()).tools).toHaveLength(3);
});
