import { COLOR_MAXIMUM } from '../../../constant';

export const getColor = (index: number) => {
  return `hsl(var(--chart-${(index % COLOR_MAXIMUM) + 1}))`;
};
