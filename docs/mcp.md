# The ai-tutor MCP server

`ai-tutor mcp --stdio` serves the CLI's to-do commands to any client that
speaks the [Model Context Protocol](https://modelcontextprotocol.io) over
stdio. The client spawns the process, talks JSON-RPC to its stdin and stdout,
and gets three tools:

| Tool | Arguments | What it does |
| --- | --- | --- |
| `list_todos` | `q` (optional) | Lists the to-dos, done ones included; `q` keeps titles containing it, ignoring case. |
| `add_todo` | `title` | Puts a new item on the list. |
| `mark_todo_done` | `id` | Ticks off the item with that id. |

They are the same calls `ai-tutor list`, `add` and `done` make, against the
same `/api/todos`, with the same stored session token — so the tools see
exactly the signed-in user's items and nobody else's.

Two things have to be true before a tool call can work:

- **the web app is running**, at `http://localhost:3000` unless
  `AI_TUTOR_SERVER` says otherwise (`npm run dev` from the repository root);
- **the terminal is signed in** — `npx ai-tutor login` once, approving the code
  it prints in a browser already signed in to the app.

Neither is needed to *start* the server. It connects and lists its tools
without a token, and a tool called without one answers with an error telling
the user to run `ai-tutor login`, so registering it before signing in is fine.

## Register it with Claude Code for this repository

From the repository root:

```bash
claude mcp add --scope project ai-tutor -- npx ai-tutor mcp --stdio
```

The `--` matters: everything after it is the command Claude Code spawns, and
everything before it is Claude Code's own options. `--scope project` writes
`.mcp.json` at the repository root, which is the shared, checked-in form:

```json
{
  "mcpServers": {
    "ai-tutor": {
      "type": "stdio",
      "command": "npx",
      "args": ["ai-tutor", "mcp", "--stdio"],
      "env": {}
    }
  }
}
```

Claude Code asks once per project before it trusts a `.mcp.json` it did not
write, so approve it on the next start. Drop `--scope project` to keep the
registration to yourself instead — it then lands in `~/.claude.json` under this
project and nothing in the repository changes.

`npx ai-tutor` resolves through this workspace's `node_modules/.bin`, which
`npm install` links, so the registration above only works with the repository
as the working directory.

## Register it for a project elsewhere on the machine

Outside this repository, `npx ai-tutor` is not this CLI and will not fail
loudly either: `npx` resolves it through `node_modules/.bin`, which only this
workspace has, and otherwise falls back to the npm registry — where `ai-tutor`
is an unrelated published package (an LMS chatbot widget). It would fetch and
run that. Point at the committed bin wrapper by absolute path instead, from the
other project's directory:

```bash
claude mcp add ai-tutor -- node /path/to/todo-manager/cli/bin/ai-tutor.js mcp --stdio
```

Add `--scope user` to make it available in every project on the machine rather
than only that one. If the app is not on `http://localhost:3000`, pass the
address too:

```bash
claude mcp add --env AI_TUTOR_SERVER=http://localhost:4000 --scope user ai-tutor \
  -- node /path/to/todo-manager/cli/bin/ai-tutor.js mcp --stdio
```

`--env` goes before the server name; after it, Claude Code reads it as another
argument. The token is not an environment variable — it stays in `hosts.json`
in your config directory, and the server reads it there on every call, so one
`ai-tutor login` covers every project you register this in.

## Check that it is connected

```bash
claude mcp list          # ✔ Connected, or the error it failed with
claude mcp get ai-tutor  # the command, args and env it was registered with
```

`✔ Connected` only means the process started and answered the handshake. It
says nothing about the app or the login, because neither is touched until a
tool is called — a server pointed at a port with nothing behind it reports
connected too.

Inside a session, `/mcp` shows the same status and lets you inspect the tools.
When it is connected, the tools appear as `mcp__ai-tutor__list_todos`,
`mcp__ai-tutor__add_todo` and `mcp__ai-tutor__mark_todo_done`. Asking Claude
what is on your to-do list is the end-to-end check:

```bash
claude -p "What is on my to-do list right now, and which items are still open?" \
  --allowedTools "mcp__ai-tutor__list_todos"
```

To drive it by hand without a client at all:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx ai-tutor mcp --stdio
```

## When something is wrong

- **`✘ Failed to connect`** — run the command from `claude mcp get` yourself.
  `ai-tutor is not built yet` means `cli/dist` is missing: `npm install`, or
  `npm run build -w ai-tutor-cli`.
- **Every tool answers "run `ai-tutor login`"** — there is no stored token for
  the server the tools are talking to. `npx ai-tutor whoami` from the
  repository says who is signed in where; check `AI_TUTOR_SERVER` matches.
- **"cannot reach …"** — the web app is not running, or is on another port.
- **Nothing happens after a restart** — the token is read per call, so a fresh
  `ai-tutor login` takes effect without restarting the server; a changed
  registration does need `/mcp` to reconnect.

Do not add anything to the server that prints. stdout is the protocol's, and
one stray line ends the connection.
