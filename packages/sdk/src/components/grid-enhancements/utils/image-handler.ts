interface NextImageOptimizationParams {
  url: string;
  w: number;
  q: number;
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  format?: 'webp' | 'png' | 'jpg';
}

export const convertNextImageUrl = (params: NextImageOptimizationParams) => {
  const query = new URLSearchParams(params as never).toString();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/_next/image?${query}`;
};

export const findClosestWidth = (width: number, height: number): number => {
  const sizes = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];
  const aspectRatio = width / height;
  let calcWidth = width;

  if (aspectRatio > 1) {
    calcWidth = width / 2;
  } else {
    calcWidth = width / 4;
  }

  const filteredSizes = sizes.filter((size) => size <= calcWidth);
  return filteredSizes.length > 0 ? Math.max(...filteredSizes) : sizes[0];
};
