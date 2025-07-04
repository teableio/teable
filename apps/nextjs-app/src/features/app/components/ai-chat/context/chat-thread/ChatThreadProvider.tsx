import { ChatThreadContext } from './ChatThreadContext';

export const ChatThreadProvider = ({
  children,
  dataStream,
  setDataStream,
}: {
  children: React.ReactNode;
  dataStream: unknown[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDataStream: (dataStream: any) => void;
}) => {
  return (
    <ChatThreadContext.Provider value={{ dataStream, setDataStream }}>
      {children}
    </ChatThreadContext.Provider>
  );
};
