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

const createEventPromiseWithCount = (
  eventEmitterService: EventEmitterService,
  event: Events,
  count: number = 1
) => {
  let theResolve: (value: unknown) => void;

  const promise = new Promise((resolve) => {
    theResolve = resolve;
  });

  const payloads: unknown[] = [];
  eventEmitterService.eventEmitter.on(event, (payload) => {
    payloads.push(payload);
    if (payloads.length === count) {
      theResolve(payloads);
    }
  });

  return promise;
};
export function createAwaitWithEventWithResultWithCount(
  eventEmitterService: EventEmitterService,
  event: Events,
  count: number = 1
) {
  return async function fn<T>(fn: () => Promise<T>) {
    const promise = createEventPromiseWithCount(eventEmitterService, event, count);
    const result = await fn();
    const payloads = await promise;
    return {
      result,
      payloads,
    };
  };
}
