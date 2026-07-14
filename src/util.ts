/* Small shared helpers. */

/** Human-readable message from an unknown thrown value. Prefers a truthy
   `.message` (covers Error and DOMException without the "Name: " prefix that
   String(domException) adds), falling back to String(). */
export function errMsg(e: unknown): string {
  const m = (e as { message?: unknown } | null | undefined)?.message;
  return typeof m === 'string' && m ? m : String(e);
}

/** Return `url` only if it uses a safe, navigable scheme (http/https/mailto);
   otherwise ''. Blocks `javascript:` / `data:` / etc. from ever reaching an
   href or window.open, regardless of how the config arrived (gist, hand-edit).
   Requires an absolute URL - a bare host or relative path yields ''. */
export function safeUrl(url: string): string {
  try {
    const proto = new URL(url).protocol.toLowerCase();
    return proto === 'http:' || proto === 'https:' || proto === 'mailto:' ? url : '';
  } catch {
    return '';
  }
}
