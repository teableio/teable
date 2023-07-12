import type { IRectangle } from '../../../grid';

export const calculateMenuPosition = (
  container: React.RefObject<HTMLDivElement>,
  opt?: { col: number; bounds: IRectangle }
) => {
  const { col, bounds } = opt || {};

  if (!bounds || !container.current || col == undefined) {
    return {
      x: 0,
      y: 0,
    };
  }
  const x = bounds.x;

  return {
    x: x,
    y: bounds.height,
  };
};
