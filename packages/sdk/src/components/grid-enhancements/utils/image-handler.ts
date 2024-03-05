interface NextImageOptimizationParams {
  url: string;
  w: number;
  q?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  format?: 'webp' | 'png' | 'jpg';
}

export const convertNextImageUrl = (params: NextImageOptimizationParams) => {
  const query = new URLSearchParams(params as never).toString();
  return `${window.location.origin}/_next/image?${query}`;
};
