/** Anything the user should see as `error: <message>` rather than a stack. */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** Exit code 4, as `gh` uses, so a script can tell "sign in" from "it broke". */
export class NotLoggedInError extends CliError {
  constructor(message: string) {
    super(message, 4);
    this.name = "NotLoggedInError";
  }
}
