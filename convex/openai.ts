import { z } from "zod";

import { redactCredentials } from "./errors";

/**
 * Minimal OpenAI-compatible chat completions client for structured extraction.
 *
 * Everything here is server side: the API key is read from the Convex
 * deployment's environment and never reaches the browser.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_PROVIDER_MESSAGE_LENGTH = 200;

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          refusal: z.string().nullish(),
        }),
      })
    )
    .min(1),
});

export type StructuredJsonRequest = {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
};

/**
 * Asks the model for JSON matching `jsonSchema` and returns the decoded value.
 *
 * The result is only parsed, never trusted: callers must validate it against
 * their own schema before using it.
 */
export async function requestStructuredJson({
  system,
  user,
  schemaName,
  jsonSchema,
}: StructuredJsonRequest): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Statement analysis is not configured (OPENAI_API_KEY is missing).");
  }

  const model = process.env.OPENAI_MODEL;
  if (!model) {
    throw new Error("Statement analysis is not configured (OPENAI_MODEL is missing).");
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  const send = (responseFormat: Record<string, unknown>, systemSuffix = "") =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `${system}${systemSuffix}` },
          { role: "user", content: user },
        ],
        response_format: responseFormat,
      }),
      signal: requestSignal(),
    });

  let response = await send({
    type: "json_schema",
    json_schema: { name: schemaName, strict: true, schema: jsonSchema },
  });

  // Not every OpenAI-compatible gateway implements `json_schema`. When the
  // request is rejected for that reason only, fall back to JSON mode with the
  // schema spelled out in the prompt; the response is validated either way.
  if (response.status === 400) {
    const rejection = await response.text();
    if (!/response_format|json_schema/i.test(rejection)) {
      throw new Error(
        `Statement analysis was rejected by the model provider: ${safeProviderMessage(rejection)}`
      );
    }

    response = await send(
      { type: "json_object" },
      `\n\nReply with a single JSON object that matches this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`
    );
  }

  if (!response.ok) {
    const failure = await response.text();
    throw new Error(
      `Statement analysis failed at the model provider (${response.status}): ${safeProviderMessage(failure)}`
    );
  }

  const parsed = chatCompletionSchema.safeParse((await response.json()) as unknown);
  if (!parsed.success) {
    throw new Error("The model provider returned an unexpected response shape.");
  }

  const message = parsed.data.choices[0].message;
  if (message.refusal) {
    throw new Error("The model declined to read this statement.");
  }
  if (!message.content) {
    throw new Error("The model returned an empty response.");
  }

  return parseJsonContent(message.content);
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    throw new Error("The model response was not valid JSON.");
  }
}

function safeProviderMessage(body: string): string {
  return redactCredentials(body).replace(/\s+/g, " ").trim().slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
}

function requestSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}
