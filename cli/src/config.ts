import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CliError } from "./errors";

export const DEFAULT_SERVER = "http://localhost:3000";

/** The web app this CLI talks to; `AI_TUTOR_SERVER` overrides the default. */
export function serverUrl(): string {
  const raw = process.env.AI_TUTOR_SERVER?.trim();
  if (!raw) return DEFAULT_SERVER;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(`AI_TUTOR_SERVER is not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError(`AI_TUTOR_SERVER must be http or https: ${raw}`);
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Where the token lives, in the order `gh` looks: an explicit override, then
 * the XDG config home, then the platform's own config directory.
 */
export function configDir(): string {
  const override = process.env.AI_TUTOR_CONFIG_DIR?.trim();
  if (override) return override;

  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, "ai-tutor");

  const appData = process.env.APPDATA?.trim();
  if (process.platform === "win32" && appData) return join(appData, "ai-tutor");

  return join(homedir(), ".config", "ai-tutor");
}

/** Keyed by server URL, so two servers can be signed in to independently. */
const hostsSchema = z.record(z.string(), z.object({ token: z.string() }));
type Hosts = z.infer<typeof hostsSchema>;

const hostsPath = () => join(configDir(), "hosts.json");

async function readHosts(): Promise<Hosts> {
  let contents: string;
  try {
    contents = await readFile(hostsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch {
    data = undefined;
  }

  const parsed = hostsSchema.safeParse(data);
  if (!parsed.success) {
    throw new CliError(
      `${hostsPath()} is not a valid credentials file — delete it and run \`ai-tutor login\` again`,
    );
  }
  return parsed.data;
}

/**
 * Owner-only, and written through a temporary file so a crash cannot leave a
 * half-written token behind. The directory is owner-only too, as `gh`'s is.
 */
async function writeHosts(hosts: Hosts): Promise<void> {
  const path = hostsPath();
  if (Object.keys(hosts).length === 0) {
    await rm(path, { force: true });
    return;
  }

  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(hosts, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function readToken(server: string): Promise<string | undefined> {
  return (await readHosts())[server]?.token;
}

export async function writeToken(
  server: string,
  token: string,
): Promise<string> {
  const hosts = await readHosts();
  hosts[server] = { token };
  await writeHosts(hosts);
  return hostsPath();
}

export async function deleteToken(server: string): Promise<void> {
  const hosts = await readHosts();
  delete hosts[server];
  await writeHosts(hosts);
}
