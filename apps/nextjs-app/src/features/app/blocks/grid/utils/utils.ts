export type ITimeoutID = {
  id: number;
};

export const cancelTimeout = (timeoutID: ITimeoutID) => {
  cancelAnimationFrame(timeoutID.id);
};

export const requestTimeout = (callback: () => void, delay: number): ITimeoutID => {
  const start = Date.now();

  function tick() {
    if (Date.now() - start >= delay) {
      callback.call(null);
    } else {
      timeoutID.id = requestAnimationFrame(tick);
    }
  }

  const timeoutID: ITimeoutID = {
    id: requestAnimationFrame(tick),
  };
  return timeoutID;
};

export const isWindowsOS = () => {
  const agent = navigator.userAgent.toLowerCase();
  return /win32|wow32|win64|wow64/.test(agent);
};
