import { createContext } from 'react';

export interface EmotionStyleClientData {
  reset: () => void;
}

export const EmotionStyleClientContext = createContext<EmotionStyleClientData>({
  reset: () => {
    if (process.env.NODE_ENV === 'development') {
      console.log('EmotionClientContext.reset() has been called');
    }
  },
});
