import type { Rectangle } from '@glideapps/glide-data-grid';

export const calculateCellPosition = (
  container: React.RefObject<HTMLDivElement>,
  rectangle: Rectangle
) => {
  if (!container.current || !rectangle) {
    return {
      x: 0,
      y: 0,
    };
  }
  return {
    x: rectangle.x - container.current.offsetLeft,
    y: rectangle.y - container.current.offsetTop,
  };
};
