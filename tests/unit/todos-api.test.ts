// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  errorResponseSchema,
  listTodosResponseSchema,
  todoResponseSchema,
} from "@ai-tutor/todo-api-schema";
import { betterAuth } from "better-auth";
import { type TestHelpers, testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { authOptions } from "@/lib/auth-config";

// The routes import lib/auth and lib/db, which are `server-only` and open
// DATABASE_URL on import; the stub lets them load, and the env below points
// them at a throwaway file, so these are the real handlers and auth instance.
vi.mock("server-only", () => ({}));

const secret = "test-secret-at-least-32-characters-long";

let dir: string;
let testDb: ReturnType<typeof drizzle>;
let helpers: TestHelpers;
let routes: typeof import("@/app/api/todos/route");
let itemRoute: typeof import("@/app/api/todos/[id]/route");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-todos-api-"));
  const url = `file:${join(dir, "test.db")}`;
  testDb = drizzle({ connection: { url } });
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  routes = await import("@/app/api/todos/route");
  itemRoute = await import("@/app/api/todos/[id]/route");

  // Mints sessions in the same file the app's instance verifies; testUtils
  // stays out of lib/auth.ts, and the plugin array stays a literal for types.
  const testAuth = betterAuth({
    ...authOptions(testDb),
    secret,
    baseURL: "http://localhost:3000",
    plugins: [testUtils()],
  });
  helpers = (await testAuth.$context).test;
});

afterAll(async () => {
  (await import("@/lib/db")).db.$client.close();
  testDb.$client.close();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const url = (path = "") => `http://localhost:3000/api/todos${path}`;

const json = (method: string, body: unknown, headers?: HeadersInit) =>
  new Request(url(), {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function signIn() {
  const user = await helpers.saveUser(helpers.createUser());
  return helpers.login({ userId: user.id });
}

describe("without a token", () => {
  test("GET /api/todos answers 401", async () => {
    const response = await routes.GET(new Request(url()));

    expect(response.status).toBe(401);
    expect(errorResponseSchema.parse(await response.json())).toEqual({
      error: "unauthorized",
    });
  });

  test("POST /api/todos answers 401", async () => {
    const response = await routes.POST(json("POST", { title: "Buy milk" }));

    expect(response.status).toBe(401);
  });

  test("PATCH /api/todos/{id} answers 401", async () => {
    const response = await itemRoute.PATCH(
      new Request(url("/some-id"), { method: "PATCH", body: '{"done":true}' }),
      params("some-id"),
    );

    expect(response.status).toBe(401);
  });
});

test("a bearer token adds an item, lists it, marks it done, and filters", async () => {
  const { token } = await signIn();
  const bearer = { authorization: `Bearer ${token}` };

  const created = await routes.POST(
    json("POST", { title: " Buy milk " }, bearer),
  );
  expect(created.status).toBe(201);
  const { todo } = todoResponseSchema.parse(await created.json());
  expect(todo).toEqual({
    id: expect.any(String),
    title: "Buy milk",
    done: false,
  });

  const listed = await routes.GET(new Request(url(), { headers: bearer }));
  expect(listed.status).toBe(200);
  expect(listTodosResponseSchema.parse(await listed.json())).toEqual({
    todos: [todo],
  });

  const patched = await itemRoute.PATCH(
    new Request(url(`/${todo.id}`), {
      method: "PATCH",
      headers: bearer,
      body: JSON.stringify({ done: true }),
    }),
    params(todo.id),
  );
  expect(patched.status).toBe(200);
  expect(todoResponseSchema.parse(await patched.json())).toEqual({
    todo: { ...todo, done: true },
  });

  const filtered = await routes.GET(
    new Request(url("?q=MILK"), { headers: bearer }),
  );
  expect(listTodosResponseSchema.parse(await filtered.json())).toEqual({
    todos: [{ ...todo, done: true }],
  });

  const unmatched = await routes.GET(
    new Request(url("?q=bread"), { headers: bearer }),
  );
  expect(await unmatched.json()).toEqual({ todos: [] });
});

test("a session cookie reads the list, as the sidebar does, but cannot write", async () => {
  const { headers } = await signIn();

  const listed = await routes.GET(new Request(url(), { headers }));
  expect(listed.status).toBe(200);

  const created = await routes.POST(
    json("POST", { title: "Planted" }, Object.fromEntries(headers)),
  );
  expect(created.status).toBe(401);
});
