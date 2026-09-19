/**
 * Convex Auth's provider config.
 *
 * `domain` must be the deployment's **site** URL — the host that serves HTTP
 * actions, where `/api/auth/*` lives. Pointing this at the `.convex.cloud`
 * functions host is the classic mistake: tokens get issued but can never be
 * verified, and every request looks unauthenticated for no visible reason.
 *
 * `CONVEX_SITE_URL` is set automatically by `npx convex dev` for local
 * deployments and by the Convex dashboard for cloud ones.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
