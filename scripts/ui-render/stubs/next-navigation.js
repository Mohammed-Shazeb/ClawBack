/**
 * Stub for `next/navigation`, used only by the offline UI render harness.
 *
 * These hooks read from Next's App Router context, which does not exist when a
 * component is server-rendered by a plain Node process: the real `usePathname`
 * returns null here, and `AppShell` then throws on `pathname.startsWith(...)`.
 * In the running app the value is always a string, so the stub supplies one —
 * `globalThis.__PATHNAME__` lets a test render a specific route.
 *
 * Only `next/navigation` is stubbed. `next/link` stays the real module, so the
 * markup the harness asserts is the markup Next itself produces.
 */

export function usePathname() {
  return globalThis.__PATHNAME__ ?? "/";
}

export function useRouter() {
  return {
    push() {},
    replace() {},
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
  };
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams() {
  return {};
}
