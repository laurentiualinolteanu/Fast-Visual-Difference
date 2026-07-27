import { TestBed } from '@angular/core/testing';
import { MessageService, ToastMessageOptions } from 'primeng/api';

import { GlobalErrorHandler } from './global-error-handler';

describe('GlobalErrorHandler', () => {
  let toasts: ToastMessageOptions[];
  let handler: GlobalErrorHandler;

  function configure(messageService: unknown): GlobalErrorHandler {
    // A spec may reconfigure to swap the message service; TestBed refuses to be
    // reconfigured once something has been injected from it.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [GlobalErrorHandler, { provide: MessageService, useValue: messageService }],
    });
    return TestBed.inject(GlobalErrorHandler);
  }

  beforeEach(() => {
    toasts = [];
    spyOn(console, 'error');
    handler = configure({ add: (message: ToastMessageOptions) => toasts.push(message) });
  });

  it('turns an unexpected error into something the user can read', () => {
    handler.handleError(new Error('cannot read properties of undefined'));

    expect(toasts.length).toBe(1);
    expect(toasts[0].severity).toBe('error');
    expect(toasts[0].detail).toBe('cannot read properties of undefined');
  });

  it('keeps the stack in the console, where a developer will look for it', () => {
    // The toast carries the message only; a stack trace in a toast helps nobody.
    const error = new Error('boom');
    handler.handleError(error);

    expect(console.error).toHaveBeenCalledWith(error);
  });

  it('unwraps a rejection, which is how an unhandled promise arrives', () => {
    // `provideBrowserGlobalErrorListeners` routes unhandled rejections here wrapped in an
    // object; reporting "[object Object]" to the user would waste the whole mechanism.
    handler.handleError({ rejection: new Error('the worker never answered') });

    expect(toasts[0].detail).toBe('the worker never answered');
  });

  it('survives something that is not an Error at all', () => {
    handler.handleError('a bare string');
    handler.handleError(undefined);

    expect(toasts.map((toast) => toast.detail)).toEqual(['a bare string', 'undefined']);
  });

  it('does not re-enter itself when reporting fails', () => {
    // An exception thrown inside an error handler is handled by the error handler. The
    // console call has already happened, so the failure is recorded either way.
    const exploding = configure({
      add: () => {
        throw new Error('the toast system is the thing that broke');
      },
    });

    expect(() => exploding.handleError(new Error('original'))).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});
