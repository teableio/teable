import type { EventEmitterService } from '../../src/event-emitter/event-emitter.service';
import type { Events } from '../../src/event-emitter/events';

export function createEventPromise(eventEmitterService: EventEmitterService, event: Events) {
  let theResolve: (value: unknown) => void;

  const promise = new Promise((resolve) => {
    theResolve = resolve;
  });

  eventEmitterService.eventEmitter.once(event, (payload) => {
    theResolve(payload);
  });

  return promise;
}

export function createAwaitWithEvent(eventEmitterService: EventEmitterService, event: Events) {
  return async function fn<T>(fn: () => Promise<T>) {
    const promise = createEventPromise(eventEmitterService, event);
    const result = await fn();
    await promise;
    return result;
  };
}

export function createAwaitWithEventWithResult<R = unknown>(
  eventEmitterService: EventEmitterService,
  event: Events
) {
  return async function fn<T>(fn: () => Promise<T>) {
    const promise = createEventPromise(eventEmitterService, event);
    await fn();
    await promise;
    return (await promise) as R;
  };
}
