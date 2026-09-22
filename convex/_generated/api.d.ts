/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentmail from "../agentmail.js";
import type * as assessment from "../assessment.js";
import type * as assessments from "../assessments.js";
import type * as auth from "../auth.js";
import type * as authEmail from "../authEmail.js";
import type * as caller from "../caller.js";
import type * as cases from "../cases.js";
import type * as deductions from "../deductions.js";
import type * as diagnostics from "../diagnostics.js";
import type * as emails from "../emails.js";
import type * as errors from "../errors.js";
import type * as extraction from "../extraction.js";
import type * as firecrawl from "../firecrawl.js";
import type * as http from "../http.js";
import type * as letter from "../letter.js";
import type * as letters from "../letters.js";
import type * as openai from "../openai.js";
import type * as outbound from "../outbound.js";
import type * as questions from "../questions.js";
import type * as research from "../research.js";
import type * as response from "../response.js";
import type * as responses from "../responses.js";
import type * as send from "../send.js";
import type * as sources from "../sources.js";
import type * as svix from "../svix.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentmail: typeof agentmail;
  assessment: typeof assessment;
  assessments: typeof assessments;
  auth: typeof auth;
  authEmail: typeof authEmail;
  caller: typeof caller;
  cases: typeof cases;
  deductions: typeof deductions;
  diagnostics: typeof diagnostics;
  emails: typeof emails;
  errors: typeof errors;
  extraction: typeof extraction;
  firecrawl: typeof firecrawl;
  http: typeof http;
  letter: typeof letter;
  letters: typeof letters;
  openai: typeof openai;
  outbound: typeof outbound;
  questions: typeof questions;
  research: typeof research;
  response: typeof response;
  responses: typeof responses;
  send: typeof send;
  sources: typeof sources;
  svix: typeof svix;
  users: typeof users;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
