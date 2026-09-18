import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { type TestHelpers, testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { expect } from "vitest";
import { authOptions } from "@/lib/auth-config";

/**
 * What both CLI suites need before they can run a command: a real `next dev`
 * on a spare port over a temp database, a signed-up user, and a config
 * directory of its own so the token never lands in the developer's. Better
 * Auth's test utils stand in for the browser at the one point a browser would
 * be needed — the approval of the device code.
 */

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const cliBin = join(repoRoot, "cli", "bin", "ai-tutor.js");

const secret = "test-secret-at-least-32-characters-long";

export type CliResult = { code: number | null; stdout: string; stderr: string };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

export type TodoServer = Awaited<ReturnType<typeof startTodoServer>>;

/**
 * `distDir` is per suite, because `next dev` refuses to start twice against
 * one dist dir and Vitest may run the suites side by side.
 */
export async function startTodoServer({ distDir }: { distDir: string }) {
  const dir = await mkdtemp(join(tmpdir(), "ai-tutor-cli-"));
  const configHome = join(dir, "config");
  const hostsPath = join(configHome, "ai-tutor", "hosts.json");

  const url = `file:${join(dir, "app.db")}`;
  const db = drizzle({ connection: { url } });
  await migrate(db, { migrationsFolder: join(repoRoot, "drizzle") });

  const baseUrl = `http://localhost:${await freePort()}`;
  const server: ChildProcess = spawn(
    "npx",
    ["next", "dev", "--port", new URL(baseUrl).port],
    {
      cwd: repoRoot,
      // Own process group, so the teardown can take the Turbopack children
      // with it.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Vitest sets NODE_ENV=test, which would make `next dev` rewrite this
        // repo's tsconfig.json include patterns on every run.
        NODE_ENV: "development",
        NEXT_DIST_DIR: distDir,
        DATABASE_URL: url,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: baseUrl,
      },
    },
  );

  let serverLog = "";
  const collect = (chunk: unknown) => {
    serverLog += String(chunk);
  };
  server.stdout?.on("data", collect);
  server.stderr?.on("data", collect);

  const deadline = Date.now() + 150_000;
  for (;;) {
    try {
      if ((await fetch(`${baseUrl}/api/auth/ok`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `the dev server never answered on ${baseUrl}\n${serverLog}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Mints the session that approves the device code, in the same file and
  // under the same secret as the server verifies against.
  const testAuth = betterAuth({
    ...authOptions(db),
    secret,
    baseURL: baseUrl,
    plugins: [testUtils()],
  });
  const helpers: TestHelpers = (await testAuth.$context).test;
  const user = await helpers.saveUser(
    helpers.createUser({ name: "Ada Lovelace" }),
  );

  /** Plain strings, because the MCP stdio transport takes no `undefined`. */
  const cliEnv = (): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    delete env.AI_TUTOR_CONFIG_DIR;
    return { ...env, AI_TUTOR_SERVER: baseUrl, XDG_CONFIG_HOME: configHome };
  };

  function startCli(args: string[]) {
    const child = spawn(process.execPath, [cliBin, ...args], {
      // Strings only, so it is narrower than ProcessEnv rather than unsound.
      env: cliEnv() as NodeJS.ProcessEnv,
    });
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

  /** The browser's half of the device flow: claim the code, then approve it. */
  async function approveDeviceCode(userCode: string) {
    const code = userCode.replaceAll("-", "");
    const { headers } = await helpers.login({ userId: user.id });

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

  /** `ai-tutor login` start to finish, with the approval done for it. */
  async function loginCli(): Promise<CliResult> {
    const login = startCli(["login"]);

    const userCode = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no code printed:\n${login.result.stdout}`)),
        30_000,
      );
      login.child.stdout.on("data", () => {
        const match = login.result.stdout.match(
          /approve the code ([A-Z0-9-]+)/,
        );
        if (!match) return;
        clearTimeout(timer);
        resolve(match[1]);
      });
      login.child.on("close", () => {
        clearTimeout(timer);
        reject(new Error(`login exited early:\n${login.result.stderr}`));
      });
    });

    await approveDeviceCode(userCode);
    return login.done;
  }

  return {
    baseUrl,
    userId: user.id,
    userEmail: user.email,
    hostsPath,
    cliEnv,
    startCli,
    runCli: (args: string[]) => startCli(args).done,
    approveDeviceCode,
    loginCli,
    storedToken: async (): Promise<string | undefined> => {
      const hosts: unknown = JSON.parse(await readFile(hostsPath, "utf8"));
      return (hosts as Record<string, { token: string }>)[baseUrl]?.token;
    },
    async stop() {
      if (server.pid) {
        try {
          process.kill(-server.pid, "SIGTERM");
        } catch {
          server.kill("SIGTERM");
        }
      }
      db.$client.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
