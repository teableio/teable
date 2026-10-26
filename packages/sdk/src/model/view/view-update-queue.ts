/**
 * The server applies a view update against the view version it loaded and rejects a request
 * that raced another update to the same view (`view.version_conflict`). An editor that saves
 * as the user types (the filter saves 300ms after each pause) would race its own previous save
 * whenever the server takes longer than that, and the rejected save rolls the edit back. So
 * this tab sends the updates of one view one at a time, in the order they were made.
 */
const pendingViewUpdates = new Map<string, Promise<unknown>>();

// A request that never settles must not block every later update of the view.
const MAX_WAIT_FOR_PREVIOUS_MS = 15_000;

export const enqueueViewUpdate = <R>(viewId: string, send: () => Promise<R>): Promise<R> => {
  const previous = pendingViewUpdates.get(viewId);
  const settled = previous
    ? Promise.race([
        previous.then(
          () => undefined,
          () => undefined
        ),
        new Promise<void>((resolve) => setTimeout(resolve, MAX_WAIT_FOR_PREVIOUS_MS)),
      ])
    : Promise.resolve();
  const request = settled.then(send);
  const tail = request.then(
    () => undefined,
    () => undefined
  );
  pendingViewUpdates.set(viewId, tail);
  void tail.then(() => {
    if (pendingViewUpdates.get(viewId) === tail) pendingViewUpdates.delete(viewId);
  });
  return request;
};
