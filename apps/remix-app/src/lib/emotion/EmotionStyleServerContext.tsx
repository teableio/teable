import { createContext } from 'react';

export interface EmotionStyleServerContextData {
  key: string;
  ids: string[];
  css: string;
}

export const EmotionStyleServerContext = createContext<
  null | EmotionStyleServerContextData[]
>(null);
