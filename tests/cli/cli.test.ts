import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listTodosResponseSchema,
  todoResponseSchema,
} from "@ai-tutor/todo-api-schema";
import { betterAuth } from "better-auth";
import { type TestHelpers, testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authOptions } from "@/lib/auth-config";

/**
 * The CLI end to end: the built `cli/dist` bundle against a real `next dev`
 * on a spare port, over a temp database, with the config directory redirected
 * so the token never lands in the developer's own. Better Auth's test utils
 * stand in for the browser at the one point a browser would be needed — the
 * approval of the device code.
 */

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliBin = join(repoRoot, "cli", "bin", "ai-tutor.js");
const secret = "test-secret-at-least-32-characters-long";

let dir: string;
let configHome: string;
let baseUrl: string;
let db: ReturnType<typeof drizzle>;
let helpers: TestHelpers;
let server: ChildProcess;
let serverLog = "";
let userId: string;
let userEmail: string;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

async function waitForServer(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/auth/ok`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the dev server never answered on ${baseUrl}\n${serverLog}`);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-cli-"));
  configHome = join(dir, "config");

  const url = `file:${join(dir, "app.db")}`;
  db = drizzle({ connection: { url } });
  await migrate(db, { migrationsFolder: join(repoRoot, "drizzle") });

  baseUrl = `http://localhost:${await freePort()}`;
  server = spawn("npx", ["next", "dev", "--port", new URL(baseUrl).port], {
    cwd: repoRoot,
    // Own dist dir, so this server never fights the lock of a `npm run dev`
    // or of the Playwright suite; own process group, so the teardown can take
    // the Turbopack children with it.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Vitest sets NODE_ENV=test, which would make `next dev` rewrite this
      // repo's tsconfig.json include patterns on every run.
      NODE_ENV: "development",
      NEXT_DIST_DIR: ".next-cli",
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: baseUrl,
    },
  });
  const collect = (chunk: unknown) => {
    serverLog += String(chunk);
  };
  server.stdout?.on("data", collect);
  server.stderr?.on("data", collect);
  await waitForServer(150_000);

  // Mints the session that approves the device code, in the same file and
  // under the same secret as the server verifies against.
  const testAuth = betterAuth({
    ...authOptions(db),
    secret,
    baseURL: baseUrl,
    plugins: [testUtils()],
  });
  helpers = (await testAuth.$context).test;

  const user = await helpers.saveUser(
    helpers.createUser({ name: "Ada Lovelace" }),
  );
  userId = user.id;
  userEmail = user.email;
});

afterAll(async () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  db?.$client.close();
  await rm(dir, { recursive: true, force: true });
});

const cliEnv = () => ({
  ...process.env,
  AI_TUTOR_SERVER: baseUrl,
  XDG_CONFIG_HOME: configHome,
  AI_TUTOR_CONFIG_DIR: undefined,
});

type CliResult = { code: number | null; stdout: string; stderr: string };

function startCli(args: string[]) {
  const child = spawn(process.execPath, [cliBin, ...args], { env: cliEnv() });
  const result: CliResult = { code: null, stdout: "", stderr: "" };
  child.stdout.on("data", (chunk) => {
    result.stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    result.stderr += String(chunk);
  });
  const done = new Promise<CliResult>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ ...result, code }));
  });
  return { child, result, done };
}

const runCli = (args: string[]) => startCli(args).done;

/** The browser's half of the flow: claim the code, then approve it. */
async function approveDeviceCode(userCode: string) {
  const code = userCode.replaceAll("-", "");
  const { headers } = await helpers.login({ userId });

  const claimed = await fetch(
    `${baseUrl}/api/auth/device?user_code=${encodeURIComponent(code)}`,
    { headers },
  );
  expect(claimed.status).toBe(200);

  const approved = await fetch(`${baseUrl}/api/auth/device/approve`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(headers),
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: JSON.stringify({ userCode: code }),
  });
  expect(approved.status).toBe(200);
}

const hostsPath = () => join(configHome, "ai-tutor", "hosts.json");

const storedToken = async () => {
  const hosts: unknown = JSON.parse(await readFile(hostsPath(), "utf8"));
  return (hosts as Record<string, { token: string }>)[baseUrl]?.token;
};

let todoId: string;

test("login prints a code, waits for approval, and stores the token", async () => {
  const login = startCli(["login"]);

  const userCode = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no code printed:\n${login.result.stdout}`)),
      30_000,
    );
    login.child.stdout.on("data", () => {
      const match = login.result.stdout.match(/approve the code ([A-Z0-9-]+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });

  expect(login.result.stdout).toContain(`${baseUrl}/device?user_code=`);
  await approveDeviceCode(userCode);

  const { code, stdout } = await login.done;
  expect(code).toBe(0);
  expect(stdout).toContain(`Logged in to ${baseUrl} as Ada Lovelace`);
  expect(stdout).toContain(userEmail);

  // The token is written, but never shown.
  const token = await storedToken();
  expect(token).toBeTruthy();
  expect(stdout).not.toContain(token);
  expect((await stat(hostsPath())).mode & 0o777).toBe(0o600);
});

test("whoami names the approving user", async () => {
  const { code, stdout } = await runCli(["whoami"]);

  expect(code).toBe(0);
  expect(stdout.trim()).toBe(`Ada Lovelace <${userEmail}> on ${baseUrl}`);
});

test("add creates a to-do", async () => {
  const { code, stdout } = await runCli(["add", "--json", "Buy oat milk"]);

  expect(code).toBe(0);
  const { todo } = todoResponseSchema.parse(JSON.parse(stdout));
  expect(todo).toMatchObject({ title: "Buy oat milk", done: false });
  todoId = todo.id;

  const second = await runCli(["add", "Write the migration"]);
  expect(second.code).toBe(0);
  expect(second.stdout).toContain("Added [ ]");
  expect(second.stdout).toContain("Write the migration");
});

test("list shows both items and filters like the API", async () => {
  const listed = await runCli(["list"]);
  expect(listed.code).toBe(0);
  expect(listed.stdout).toContain(`[ ] ${todoId}  Buy oat milk`);
  expect(listed.stdout).toContain("Write the migration");

  const filtered = await runCli(["list", "--query", "OAT", "--json"]);
  expect(filtered.code).toBe(0);
  expect(listTodosResponseSchema.parse(JSON.parse(filtered.stdout))).toEqual({
    todos: [{ id: todoId, title: "Buy oat milk", done: false }],
  });

  const unmatched = await runCli(["list", "--query", "bicycle"]);
  expect(unmatched.stdout).toContain('Nothing matches "bicycle".');
});

test("done marks the item, and the list agrees", async () => {
  const { code, stdout } = await runCli(["done", todoId]);
  expect(code).toBe(0);
  expect(stdout).toContain(`Done [x] ${todoId}`);

  const listed = await runCli(["list", "--json"]);
  const { todos } = listTodosResponseSchema.parse(JSON.parse(listed.stdout));
  expect(todos).toContainEqual({
    id: todoId,
    title: "Buy oat milk",
    done: true,
  });

  const missing = await runCli(["done", "not-an-id"]);
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain("no todo with id not-an-id");
});

test("logout revokes the session on the server and drops the token", async () => {
  const token = await storedToken();

  const { code, stdout } = await runCli(["logout"]);
  expect(code).toBe(0);
  expect(stdout).toContain(`Logged out of ${baseUrl}`);

  const rejected = await fetch(`${baseUrl}/api/todos`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(rejected.status).toBe(401);
});

test("whoami fails once logged out", async () => {
  const { code, stderr } = await runCli(["whoami"]);

  expect(code).toBe(4);
  expect(stderr).toContain("not logged in");
  expect(stderr).toContain("ai-tutor login");
});
