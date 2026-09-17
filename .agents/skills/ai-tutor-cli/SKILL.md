---
name: ai-tutor-cli
description: How to work with the user's to-do list from the shell through this repo's `ai-tutor` CLI — adding items, listing or filtering them, marking them done, and handling the sign-in it needs. Use this whenever the user asks you to put something on their list, tell them what is on it or still open, tick something off, or search it, and whenever you need their to-dos as data for something else. Use it even when they never say "CLI" or "ai-tutor" — "add X to my list" or "what's on my list?" is this skill — and use it instead of curling /api/todos, reading data/app.db, or talking to the chat agent.
---

# The ai-tutor CLI

`npx ai-tutor` from the repo root is this project's command-line client for the
to-do API. It carries the signed-in user's session token, so it sees exactly
their items — which is why it beats the alternatives: `curl` against
`/api/todos` needs a token you do not have, and reading `data/app.db` shows
every user's rows with no scoping at all.

It talks to `http://localhost:3000` unless `AI_TUTOR_SERVER` says otherwise, so
the app has to be running (`npm run dev`). If the CLI reports it cannot reach
the server, say so plainly rather than falling back to the database.

## Signing in needs the user, not you

Every command except `login` needs a stored session token, and getting one is
deliberately a human act: `ai-tutor login` prints a code that someone has to
approve in a browser already signed in to the web app. You cannot complete that
yourself — so do not try to script the approval, and never ask for a password.

A command that exits with code **4** means there is no usable token. Stop there
and hand it back, for example:

> Your terminal isn't signed in to the app yet. Run `npx ai-tutor login`,
> approve the code it prints in your browser, then tell me and I'll add that
> straight away.

Exit codes are the quick signal: `0` worked, `4` sign in first, `1` anything
else (the message on stderr says what). There is no need to check `whoami`
first to see whether a token exists — run the command the user asked for and
let a 4 tell you, which costs one call instead of two in the usual case where
they are already signed in.

## The commands, one example each

```bash
npx ai-tutor whoami                            # who the stored token belongs to
npx ai-tutor add "Call the dentist"             # quote the title
npx ai-tutor list                               # [ ] open, [x] done, then the id and title
npx ai-tutor list --query dentist               # the API's ?q=, case-insensitive substring
npx ai-tutor done 8f0c2c31-2f38-4d3e-9a0e-2c0b  # the id that `list` prints
npx ai-tutor logout                             # revokes the session, deletes the token
```

Add `--json` to any of them when you want to parse rather than display the
result — `list --json` gives `{"todos":[{"id":…,"title":…,"done":…}]}`, which
is the reliable way to pick an id out before calling `done`.

## Reporting back

`list` returns done items as well as open ones, so when the user asks what is
still open, filter (`[ ]` rows, or `done == false` from `--json`) instead of
reading the whole list back at them. Give them titles; ids are for your own
next call, and a wall of UUIDs is noise. If you changed something, say what
changed in one line — they asked for the outcome, not a transcript.

Add what they asked for rather than second-guessing it, but if the list already
holds something that looks like the same errand, add it and mention the overlap
in a clause — they can merge the two, and only they know whether those are one
task or two.

The stored token is a credential: never print it, and never open the
`hosts.json` it lives in.

## `--help` is the source of truth

The CLI documents itself, and it is what actually runs — this file is a
summary that can drift. When a flag, an argument or an exit code matters, check
`npx ai-tutor --help` or `npx ai-tutor <command> --help` and believe it over
this page if the two disagree.
