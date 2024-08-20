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
