import { customAlphabet } from 'nanoid';

export const RandomType = {
  String: 'string',
  Number: 'number',
} as const;

export type RandomType = (typeof RandomType)[keyof typeof RandomType];

const alphaNumericChars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const numericChars = '0123456789';

const alphaNumericId = customAlphabet(alphaNumericChars);
const numericId = customAlphabet(numericChars);

export const getRandomString = (length: number, type: RandomType = RandomType.String): string => {
  if (type === RandomType.Number) {
    return numericId(length);
  }
  return alphaNumericId(length);
};

const alphaNumericPattern = '[0-9a-zA-Z]';

export const prefixedIdRegex = (prefix: string, length: number): RegExp => {
  return new RegExp(`^${prefix}${alphaNumericPattern}{${length}}$`);
};

export const generatePrefixedId = (prefix: string, length: number): string => {
  return `${prefix}${getRandomString(length)}`;
};
