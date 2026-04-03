export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    const immediate = (globalThis as { setImmediate?: (task: () => void) => void }).setImmediate;
    if (typeof immediate === 'function') {
      immediate(resolve);
      return;
    }

    const timeout = (
      globalThis as {
        setTimeout?: (handler: () => void, timeout: number) => void;
      }
    ).setTimeout;
    if (typeof timeout === 'function') {
      timeout(resolve, 0);
      return;
    }

    const scheduler = (globalThis as { queueMicrotask?: (task: () => void) => void })
      .queueMicrotask;
    if (typeof scheduler === 'function') {
      scheduler(resolve);
      return;
    }

    resolve();
  });
