/**
 * Stub for `convex/react`, used only by the offline UI render harness.
 *
 * The real hooks need a live WebSocket, which this environment blocks. The
 * harness therefore feeds the component fixture data so its *rendering* can be
 * verified without a connection. Query results are keyed by the function path.
 */

export function useQuery(fn) {
  const name = fn && fn.__name;
  const fixtures = globalThis.__FIXTURES__ ?? {};
  return fixtures[name];
}

export function useMutation(fn) {
  const name = fn && fn.__name;
  return async (...args) => {
    (globalThis.__MUTATIONS__ ??= []).push({ name, args });
    return null;
  };
}

/**
 * Actions are recorded separately from mutations so a test can tell a
 * server-side call (which may hit a provider) from a plain database write.
 */
export function useAction(fn) {
  const name = fn && fn.__name;
  return async (...args) => {
    (globalThis.__ACTIONS__ ??= []).push({ name, args });
    return null;
  };
}
