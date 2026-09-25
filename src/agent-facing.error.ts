/**
 * An error whose message is written for the agent and is safe to return as a
 * tool result verbatim: it names what went wrong and what to do, and never
 * carries a token. Anything else that escapes a tool is reported as an
 * internal error with an id, and its message stays in the server log.
 */
export class AgentFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
