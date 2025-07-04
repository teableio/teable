import { createContext } from 'react';

export const ChatThreadContext = createContext<{
  dataStream?: unknown[];
  setDataStream: (dataStream: unknown[] | undefined) => void;
}>({
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setDataStream: () => {},
});
