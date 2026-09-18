import type { Todo } from "@ai-tutor/todo-api-schema";
import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { addTodo, listTodos, setTodoDone } from "./api";
import {
  fetchUser,
  pollForToken,
  requestDeviceCode,
  revokeToken,
} from "./auth";
import {
  configDir,
  DEFAULT_SERVER,
  deleteToken,
  readToken,
  serverUrl,
  writeToken,
} from "./config";
import { CliError, NotLoggedInError } from "./errors";
import { serveMcpOverStdio } from "./mcp";

const out = (line = "") => process.stdout.write(`${line}\n`);
const printJson = (value: unknown) => out(JSON.stringify(value, null, 2));

/** `[x] <id>  <title>` — the id is what `done` and the API take. */
const formatTodo = (todo: Todo) =>
  `${todo.done ? "[x]" : "[ ]"} ${todo.id}  ${todo.title}`;

/** Codes are read aloud off a screen, so they are grouped in fours. */
const formatUserCode = (code: string) =>
  (code.match(/.{1,4}/g) ?? [code]).join("-");

async function requireToken(server: string): Promise<string> {
  const token = await readToken(server);
  if (!token) {
    throw new NotLoggedInError(
      `not logged in to ${server} — run \`ai-tutor login\``,
    );
  }
  return token;
}

const program = new Command();

program
  .name("ai-tutor")
  .description(
    `Keep the to-do list of the ai-tutor web app from the terminal.

Sign in once with \`ai-tutor login\`: it prints a code, you approve that code in
a browser that is already signed in to the web app, and the session token is
stored in hosts.json in your config directory with owner-only permissions. The
token is never printed and never written into the repository.`,
  )
  .version(packageJson.version, "-v, --version")
  .showHelpAfterError("(run `ai-tutor --help` for usage)")
  .addHelpText(
    "after",
    `
Environment:
  AI_TUTOR_SERVER      the web app to talk to (default ${DEFAULT_SERVER})
  AI_TUTOR_CONFIG_DIR  where hosts.json lives (default ${configDir()})

Exit codes:
  0  the command did what it says
  1  it failed, including usage errors
  4  no stored token, or the server rejected it — run \`ai-tutor login\`

Examples:
  $ ai-tutor login
  $ ai-tutor add "Buy oat milk"
  $ ai-tutor list
  $ ai-tutor list --query milk
  $ ai-tutor done 8f0c2c31-2f38-4d3e-9a0e-2c0b9f8a1d77
  $ ai-tutor list --json | jq '.todos[] | select(.done == false)'
  $ ai-tutor mcp --stdio
`,
  );

program
  .command("login")
  .description(
    "sign in by approving a code in the browser, and store the token",
  )
  .option("--json", "print the signed-in user as JSON")
  .addHelpText(
    "after",
    `
The browser must already be signed in to the web app; the page asks that user to
approve the code. Nothing is opened for you — copy the URL. Logging in again
replaces the stored token.`,
  )
  .action(async ({ json }: { json?: boolean }) => {
    const server = serverUrl();
    const request = await requestDeviceCode(server);

    out(`Open this page in a browser signed in to ${server}:`);
    out();
    out(`  ${request.verificationUriComplete}`);
    out();
    out(`and approve the code ${formatUserCode(request.userCode)}.`);
    out();
    out(
      `To type the code in yourself instead, open ${request.verificationUri}.`,
    );
    out();
    out("Waiting for approval…");

    const token = await pollForToken(server, request);
    const user = await fetchUser(server, token);
    if (!user) {
      throw new CliError(`${server} issued a token it then rejected`);
    }

    const path = await writeToken(server, token);
    if (json) {
      printJson({ server, user, credentials: path });
      return;
    }
    out(`Logged in to ${server} as ${user.name} <${user.email}>.`);
    out(`Token stored in ${path}.`);
  });

program
  .command("whoami")
  .description("show who the stored token signs you in as")
  .option("--json", "print the user as JSON")
  .action(async ({ json }: { json?: boolean }) => {
    const server = serverUrl();
    const user = await fetchUser(server, await requireToken(server));
    if (!user) {
      throw new NotLoggedInError(
        `the stored token for ${server} is no longer valid — run \`ai-tutor login\``,
      );
    }

    if (json) {
      printJson({ server, user });
      return;
    }
    out(`${user.name} <${user.email}> on ${server}`);
  });

program
  .command("logout")
  .description("revoke the session on the server and delete the stored token")
  .action(async () => {
    const server = serverUrl();
    const token = await readToken(server);
    if (!token) {
      out(`Not logged in to ${server}.`);
      return;
    }

    try {
      await revokeToken(server, token);
    } catch (error) {
      // The point of logout is that the token stops existing here, so a server
      // that cannot be reached must not keep it on disk.
      process.stderr.write(
        `warning: the session may still be open on the server (${(error as Error).message})\n`,
      );
    }
    await deleteToken(server);
    out(`Logged out of ${server}.`);
  });

program
  .command("add")
  .description("add a to-do")
  .argument("<title...>", "what to add; unquoted words are joined with spaces")
  .option("--json", "print the new to-do as JSON")
  .action(async (title: string[], { json }: { json?: boolean }) => {
    const server = serverUrl();
    const todo = await addTodo(
      server,
      await requireToken(server),
      title.join(" "),
    );

    if (json) {
      printJson({ todo });
      return;
    }
    out(`Added ${formatTodo(todo)}`);
  });

program
  .command("list")
  .description("list your to-dos, done ones included")
  .option(
    "-q, --query <text>",
    "keep only titles containing <text>, ignoring case",
  )
  .option("--json", "print the list as JSON")
  .addHelpText(
    "after",
    `
Each line is \`[ ] <id>  <title>\`, where [x] marks a done item and <id> is what
\`ai-tutor done\` takes.`,
  )
  .action(async ({ query, json }: { query?: string; json?: boolean }) => {
    const server = serverUrl();
    const todos = await listTodos(server, await requireToken(server), query);

    if (json) {
      printJson({ todos });
      return;
    }
    if (todos.length === 0) {
      out(query ? `Nothing matches "${query}".` : "Nothing on the list yet.");
      return;
    }
    for (const todo of todos) out(formatTodo(todo));
  });

program
  .command("mcp")
  .description("serve these commands to an MCP client as tools")
  .option("--stdio", "speak MCP over stdin and stdout (the only transport)")
  .addHelpText(
    "after",
    `
For an editor or agent that speaks the Model Context Protocol: it spawns
\`ai-tutor mcp --stdio\` and gets list_todos, add_todo and mark_todo_done. The
tools use the same stored token as the commands above, so sign in first — a
tool called without one answers with an error saying so rather than failing the
connection. stdout carries the protocol and nothing else.

See docs/mcp.md in the repository for registering it with Claude Code.`,
  )
  .action(({ stdio }: { stdio?: boolean }) => {
    if (!stdio) {
      throw new CliError("`ai-tutor mcp` needs --stdio");
    }
    serveMcpOverStdio();
  });

program
  .command("done")
  .description("mark a to-do done")
  .argument("<id>", "the id `ai-tutor list` prints for the item")
  .option("--json", "print the updated to-do as JSON")
  .action(async (id: string, { json }: { json?: boolean }) => {
    const server = serverUrl();
    const todo = await setTodoDone(
      server,
      await requireToken(server),
      id,
      true,
    );

    if (json) {
      printJson({ todo });
      return;
    }
    out(`Done ${formatTodo(todo)}`);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  process.stderr.write(`error: ${error.message}\n`);
  process.exit(error.exitCode);
}
