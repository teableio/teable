import { encode } from '@nem035/gpt-3-encoder';

export const countTextTokens = (text: string) => {
  return encode(text).length;
};
