import ms from 'ms';

export const second = (value: string) => {
  return Math.floor(ms(value) / 1000);
};
