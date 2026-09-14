import { z } from "zod";

import { redactCredentials } from "./errors";

/**
 * Firecrawl (https://firecrawl.dev) server-side integration.
 *
 * Everything here runs in a Convex function: the API key is read from the
 * deployment's environment and never reaches the browser. The result is parsed
 * defensively and classified, never trusted as legal authority.
 */

const DEFAULT_BASE_URL = "https://api.firecrawl.dev/v1";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_PROVIDER_MESSAGE_LENGTH = 200;

/** How many results to ask the provider for, before filtering to official ones. */
export const SEARCH_RESULT_LIMIT = 10;
/** The most official sources stored per deduction per research pass. */
export const MAX_SOURCES_PER_DEDUCTION = 3;

export function isFirecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

const searchResultSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullish(),
  description: z.string().nullish(),
  markdown: z.string().nullish(),
});

export type FirecrawlSearchResult = {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
};

/**
 * Accepts the classic array response and the newer metadata-wrapped shapes so
 * the caller is not coupled to one response revision. Anything that is not a
 * list of results becomes an empty list.
 */
const searchResponseSchema = z
  .object({
    success: z.boolean().optional(),
    error: z.string().nullish(),
    data: z.unknown(),
  })
  .transform((value): unknown[] => {
    const data = value.data;
    if (Array.isArray(data)) return data;

    if (data && typeof data === "object") {
      const object = data as Record<string, unknown>;
      if (Array.isArray(object.results)) return object.results;
      if (object.web && typeof object.web === "object") {
        const web = object.web as Record<string, unknown>;
        if (Array.isArray(web.results)) return web.results;
      }
    }

    return [];
  });

const searchFailureSchema = z.object({
  success: z.boolean().optional(),
  error: z.string().nullish(),
});

/**
 * Normalizes a raw search response body into validated results. Exported so the
 * offline verification suite can exercise the same path the live call uses.
 */
export function parseSearchResponse(body: unknown): FirecrawlSearchResult[] {
  const parsed = searchResponseSchema.safeParse(body);
  if (!parsed.success) return [];

  const results: FirecrawlSearchResult[] = [];
  for (const raw of parsed.data) {
    const item = searchResultSchema.safeParse(raw);
    if (!item.success) continue;

    results.push({
      url: item.data.url,
      title: item.data.title?.trim() || undefined,
      description: item.data.description?.trim() || undefined,
      markdown: item.data.markdown?.trim() || undefined,
    });
  }

  return results;
}

/**
 * Searches Firecrawl for a query and returns the raw results it produces,
 * validated and normalized. The caller decides which results are authoritative
 * and therefore worth storing.
 */
export async function searchAuthoritative(query: string): Promise<FirecrawlSearchResult[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("Research is not configured (FIRECRAWL_API_KEY is missing).");
  }

  const baseUrl = (process.env.FIRECRAWL_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );

  const response = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit: SEARCH_RESULT_LIMIT,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    }),
    signal: requestSignal(),
  });

  if (!response.ok) {
    const failure = await response.text();
    throw new Error(
      `Research failed at the source provider (${response.status}): ${safeProviderMessage(failure)}`
    );
  }

  const body = (await response.json()) as unknown;

  const failure = searchFailureSchema.safeParse(body);
  if (failure.success && failure.data.success === false) {
    throw new Error(
      `Research found nothing useful: ${safeProviderMessage(failure.data.error ?? "unknown provider error")}`
    );
  }

  return parseSearchResponse(body);
}

export type SourceAuthorityKind = "OFFICIAL" | "NON_OFFICIAL";

/**
 * Picks out clearly authoritative housing/government domains. Everything else
 * is treated as non-official so it can be avoided rather than relied on.
 *
 * The patterns are intentionally narrow: rafting on a `.gov` TLD, a state
 * `state.<xx>.us` host, or an explicit legislative/court host keeps blogs,
 * law-firm marketing pages and SEO articles out of the OFFICIAL bucket.
 */
const OFFICIAL_HOST_PATTERNS: RegExp[] = [
  /\.gov$/i,
  /\.gov\.[a-z]{2}$/i,
  /(^|\.)state\.[a-z]{2}\.us$/i,
  /legislature\.[a-z]{2}(\.gov|\.us)(\.[a-z]{2})?$/i,
  /leginfo\.[a-z]{2}(\.gov|\.us)(\.[a-z]{2})?$/i,
  /courts?\.[a-z]{2}(\.gov|\.us)(\.[a-z]{2})?$/i,
];

export function classifyAuthority(url: string): SourceAuthorityKind {
  let hostname: string;

  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "NON_OFFICIAL";
  }

  if (OFFICIAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return "OFFICIAL";
  }

  return "NON_OFFICIAL";
}

export function authorityLabel(kind: SourceAuthorityKind): string {
  return kind === "OFFICIAL" ? "Government / Housing Authority" : "Non-official web source";
}

const PASSAGE_KEYWORD_PATTERN =
  /(deposit|deduct|deduction|wear|tear|damage|repair|clean|carpet|paint|itemiz|statute|penalt|interest|inspect|withhold|refund|fee|charg)/i;
const MAX_PASSAGE_PARAGRAPHS = 3;
const MAX_PASSAGE_LENGTH = 1200;

/**
 * Picks the paragraphs of a scraped page that actually speak to the deduction.
 * The provider's page content is untrusted text: this only selects and bounds
 * it, never rewrites it.
 */
export function extractRelevantPassage(
  markdown: string | undefined,
  description: string
): string | undefined {
  if (!markdown) return undefined;

  const paragraphs = markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const descriptionWords = description
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);

  const onTopic = paragraphs.filter((paragraph) => {
    const lower = paragraph.toLowerCase();
    return (
      PASSAGE_KEYWORD_PATTERN.test(paragraph) &&
      (descriptionWords.some((word) => lower.includes(word)) ||
        /deposit|deduction/i.test(paragraph))
    );
  });

  const fallback = paragraphs.filter((paragraph) => PASSAGE_KEYWORD_PATTERN.test(paragraph));
  const selected = (onTopic.length > 0 ? onTopic : fallback).slice(0, MAX_PASSAGE_PARAGRAPHS);

  if (selected.length === 0) return undefined;

  const passage = selected.join("\n\n");
  return passage.length > MAX_PASSAGE_LENGTH
    ? `${passage.slice(0, MAX_PASSAGE_LENGTH)}…`
    : passage;
}

function requestSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

function safeProviderMessage(body: string): string {
  return redactCredentials(body)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
}
