/** EXIF orientations 5-8 encode a 90°/270° rotation: displayed width/height are swapped vs. physical pixels. */
export const normalizeImageDimensions = (metadata: {
  width?: number;
  height?: number;
  orientation?: number;
}): { width?: number; height?: number } => {
  const { width, height, orientation } = metadata;
  return orientation && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
};
