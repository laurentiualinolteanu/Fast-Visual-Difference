import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

/**
 * The last line of defence: anything thrown that no one caught.
 *
 * The engine, the worker and the service each report their own failures deliberately, so
 * in normal operation this handler never fires. It exists for the case that is left —
 * a bug — where the alternative is a page that stops responding with an explanation
 * visible only in the console the user does not have open.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  /*
   * Resolved on demand rather than injected.
   *
   * Angular constructs the ErrorHandler very early, before most of the application's
   * providers exist. A constructor dependency on MessageService risks a cycle at
   * bootstrap — and a bootstrap failure in the error handler is the one failure with
   * nothing left to report it.
   */
  private readonly injector = inject(Injector);

  handleError(error: unknown): void {
    // Keep the stack where a developer can find it; the toast carries only the message.
    console.error(error);

    try {
      this.injector.get(MessageService).add({
        severity: 'error',
        summary: 'Something went wrong',
        detail: messageOf(error),
        life: 10000,
      });
    } catch {
      /*
       * Deliberately silent. Throwing here would re-enter handleError with the new
       * error, and again with the next one. The console.error above already ran, so the
       * failure is not lost — only the toast is.
       */
    }
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  // Angular wraps rejections and some listener errors; unwrap one level if it helps.
  const wrapped = (error as { rejection?: unknown })?.rejection;
  if (wrapped instanceof Error) {
    return wrapped.message;
  }
  return String(error);
}
