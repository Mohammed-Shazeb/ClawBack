import { internalAction } from "./_generated/server";
import { requestStructuredJson } from "./openai";

/**
 * One real model call, from the deployment, to prove the provider is wired up.
 *
 * `verify:live` proves the request *shape* is right, but it runs on a laptop
 * against whatever `.env.local` says. The app runs on the Convex deployment,
 * which reads a **separate** environment — so a green local run says nothing
 * about production. This closes that gap: same code path as the pipeline
 * (`requestStructuredJson`, including the `max_tokens` cap and the JSON-schema
 * contract), executed where the app actually runs.
 *
 * It writes nothing and is `internal`, so it is not reachable from a client.
 *
 *   npx convex run diagnostics:pingModel
 *
 * Returns the raw model output rather than a bare boolean: when a provider is
 * misconfigured, the difference between "402 subscription required", "401
 * unauthorized client" and "the model answered in the wrong shape" is the whole
 * diagnosis, and a boolean throws all three away.
 */
export const pingModel = internalAction({
  args: {},
  handler: async () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { type: "boolean" } },
    };

    const startedAt = Date.now();

    try {
      const raw = await requestStructuredJson({
        system:
          "You are a connectivity probe. Answer only with the JSON object described below.",
        user: "Return the JSON object with ok set to true.",
        schemaName: "ping",
        jsonSchema: schema,
      });

      return {
        ok: true,
        model: process.env.OPENAI_MODEL ?? "(unset)",
        baseUrl: process.env.OPENAI_BASE_URL ?? "(default)",
        maxTokens: process.env.OPENAI_MAX_TOKENS ?? "(default)",
        elapsedMs: Date.now() - startedAt,
        raw,
      };
    } catch (error) {
      return {
        ok: false,
        model: process.env.OPENAI_MODEL ?? "(unset)",
        baseUrl: process.env.OPENAI_BASE_URL ?? "(default)",
        maxTokens: process.env.OPENAI_MAX_TOKENS ?? "(default)",
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
