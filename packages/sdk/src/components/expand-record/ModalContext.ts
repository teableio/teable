import { createContext } from 'react';

interface IModalContext {
  ref: React.RefObject<HTMLDivElement>;
}

export const ModalContext = createContext<IModalContext>({ ref: { current: null } });
