/**
 * Provider-level failure taxonomy, in its own module so the HTTP layer
 * (src/api/validate.ts) can import it without a runtime→api circular
 * dependency: agent.ts re-exports it, api imports it from here.
 *
 * kinds:
 *  auth     the API key was rejected (401/403) — fix is replace the key
 *  network  the API was unreachable — fix is check the network
 *  upstream anything else from the provider (5xx, 429, 5xx HTML) — retry once
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: "auth" | "network" | "upstream",
    message: string,
  ) {
    super(message);
  }
}
