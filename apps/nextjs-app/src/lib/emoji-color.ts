function getEmojiAverageColor(
  emoji: string,
  size: number = 64
): { r: number; g: number; b: number } {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('No canvas context');
  }

  canvas.width = size;
  canvas.height = size;

  context.clearRect(0, 0, size, size);

  context.font = `${Math.floor(size * 0.8)}px Arial`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  context.fillText(emoji, size / 2, size / 2);

  const imageData = context.getImageData(0, 0, size, size);
  const pixels = imageData.data;

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];

    if (a > 0) {
      totalR += r;
      totalG += g;
      totalB += b;
      count++;
    }
  }

  if (count === 0) {
    return { r: 0, g: 0, b: 0 };
  }

  const avgR = Math.round(totalR / count);
  const avgG = Math.round(totalG / count);
  const avgB = Math.round(totalB / count);

  return { r: avgR, g: avgG, b: avgB };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function getEmojiColor(emoji: string, size: number = 64): string {
  try {
    const { r, g, b } = getEmojiAverageColor(emoji, size);
    return rgbToHex(r, g, b);
  } catch (error) {
    return '#000000';
  }
}
