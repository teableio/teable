export const BREAKPOINTS = {
  sm: { width: 640, columns: 2 },
  md: { width: 768, columns: 3 },
  lg: { width: 1024, columns: 4 },
  xl: { width: 1280, columns: 5 },
  '2xl': { width: 1536, columns: 6 },
} as const;

export const calculateColumns = (width: number) => {
  const breakpoint = Object.values(BREAKPOINTS)
    .reverse()
    .find((bp) => width >= bp.width);
  return breakpoint?.columns ?? 1;
};
