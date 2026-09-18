import { stat } from "node:fs/promises";
import {
  listTodosResponseSchema,
  todoResponseSchema,
} from "@ai-tutor/todo-api-schema";
import { afterAll, beforeAll, expect, test } from "vitest";
import { startTodoServer, type TodoServer } from "./todo-server";

/**
 * The CLI end to end: the built `cli/dist` bundle against the shared test
 * server, from the device login through to a logout that invalidates the token.
 * The tests run in order and share the one session.
 */

let app: TodoServer;

beforeAll(async () => {
  app = await startTodoServer({ distDir: ".next-cli" });
}, 180_000);

afterAll(async () => {
  await app?.stop();
});

let todoId: string;

test("login prints a code, waits for approval, and stores the token", async () => {
  const { code, stdout } = await app.loginCli();

  expect(code).toBe(0);
  expect(stdout).toContain(`${app.baseUrl}/device?user_code=`);
  expect(stdout).toContain(`Logged in to ${app.baseUrl} as Ada Lovelace`);
  expect(stdout).toContain(app.userEmail);

  // The token is written, but never shown.
  const token = await app.storedToken();
  expect(token).toBeTruthy();
  expect(stdout).not.toContain(token);
  expect((await stat(app.hostsPath)).mode & 0o777).toBe(0o600);
});

test("whoami names the approving user", async () => {
  const { code, stdout } = await app.runCli(["whoami"]);

  expect(code).toBe(0);
  expect(stdout.trim()).toBe(
    `Ada Lovelace <${app.userEmail}> on ${app.baseUrl}`,
  );
});

test("add creates a to-do", async () => {
  const { code, stdout } = await app.runCli(["add", "--json", "Buy oat milk"]);

  expect(code).toBe(0);
  const { todo } = todoResponseSchema.parse(JSON.parse(stdout));
  expect(todo).toMatchObject({ title: "Buy oat milk", done: false });
  todoId = todo.id;

  const second = await app.runCli(["add", "Write the migration"]);
  expect(second.code).toBe(0);
  expect(second.stdout).toContain("Added [ ]");
  expect(second.stdout).toContain("Write the migration");
});

test("list shows both items and filters like the API", async () => {
  const listed = await app.runCli(["list"]);
  expect(listed.code).toBe(0);
  expect(listed.stdout).toContain(`[ ] ${todoId}  Buy oat milk`);
  expect(listed.stdout).toContain("Write the migration");

  const filtered = await app.runCli(["list", "--query", "OAT", "--json"]);
  expect(filtered.code).toBe(0);
  expect(listTodosResponseSchema.parse(JSON.parse(filtered.stdout))).toEqual({
    todos: [{ id: todoId, title: "Buy oat milk", done: false }],
  });

  const unmatched = await app.runCli(["list", "--query", "bicycle"]);
  expect(unmatched.stdout).toContain('Nothing matches "bicycle".');
});

test("done marks the item, and the list agrees", async () => {
  const { code, stdout } = await app.runCli(["done", todoId]);
  expect(code).toBe(0);
  expect(stdout).toContain(`Done [x] ${todoId}`);

  const listed = await app.runCli(["list", "--json"]);
  const { todos } = listTodosResponseSchema.parse(JSON.parse(listed.stdout));
  expect(todos).toContainEqual({
    id: todoId,
    title: "Buy oat milk",
    done: true,
  });

  const missing = await app.runCli(["done", "not-an-id"]);
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain("no todo with id not-an-id");
});

test("logout revokes the session on the server and drops the token", async () => {
  const token = await app.storedToken();

  const { code, stdout } = await app.runCli(["logout"]);
  expect(code).toBe(0);
  expect(stdout).toContain(`Logged out of ${app.baseUrl}`);

  const rejected = await fetch(`${app.baseUrl}/api/todos`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(rejected.status).toBe(401);
});

test("whoami fails once logged out", async () => {
  const { code, stderr } = await app.runCli(["whoami"]);

  expect(code).toBe(4);
  expect(stderr).toContain("not logged in");
  expect(stderr).toContain("ai-tutor login");
});
