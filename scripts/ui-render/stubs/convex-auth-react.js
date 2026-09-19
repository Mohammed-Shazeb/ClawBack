/**
 * Stub for `@convex-dev/auth/react`, used only by the offline UI render harness.
 *
 * The real provider holds a session and talks to the deployment's auth routes,
 * neither of which exists in a plain Node render. So the harness supplies the
 * session *state* directly and records the calls the UI makes.
 *
 * The default is signed in, because that is the state every case-screen
 * assertion assumes — a test that wants the signed-out state sets
 * `globalThis.__AUTH__` before rendering. Both states are asserted in the
 * entry script: a gate that renders the workspace to a signed-out visitor is
 * the single most serious regression this UI can have, and it is invisible
 * unless the signed-out state is rendered on purpose.
 */

export function useConvexAuth() {
  return globalThis.__AUTH__ ?? { isLoading: false, isAuthenticated: true };
}

export function useAuthActions() {
  return {
    async signIn(...args) {
      (globalThis.__SIGN_INS__ ??= []).push(args);
      return { signingIn: true };
    },
    async signOut() {
      (globalThis.__SIGN_OUTS__ ??= []).push(true);
    },
  };
}

export function ConvexAuthProvider({ children }) {
  return children;
}
