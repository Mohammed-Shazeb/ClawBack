/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 *
 * NOTE: the module list below was extended by hand because `npx convex dev`
 * could not run in the environment this milestone was built in. Running
 * codegen overwrites this file with the identical list.
 * @module
 */

import type * as agentmail from "../agentmail.js";
import type * as cases from "../cases.js";
import type * as deductions from "../deductions.js";
import type * as emails from "../emails.js";
import type * as errors from "../errors.js";
import type * as extraction from "../extraction.js";
import type * as http from "../http.js";
import type * as openai from "../openai.js";
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
  cases: typeof cases;
  deductions: typeof deductions;
  emails: typeof emails;
  errors: typeof errors;
  extraction: typeof extraction;
  http: typeof http;
  openai: typeof openai;
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
