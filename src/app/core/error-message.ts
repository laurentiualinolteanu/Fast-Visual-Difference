/**
 * Turn anything that was thrown into a sentence a user can read.
 *
 * One implementation rather than one per catch site. There were three, and they had
 * already drifted: only the global error handler's copy unwrapped `rejection`, so the
 * same failure produced different text depending on which layer caught it.
 */
export function messageOf(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  /*
   * Angular's global listeners deliver an unhandled promise rejection wrapped in an
   * object rather than as the rejection itself. Without this the user is shown
   * "[object Object]", which wastes the entire mechanism that caught it.
   */
  const rejection = (cause as { rejection?: unknown })?.rejection;
  if (rejection instanceof Error) {
    return rejection.message;
  }

  return String(cause);
}
