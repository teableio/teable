import { useEffect, useState } from 'react';
import { getEmojiColor } from '@/lib/emoji-color';

const colorCache: Record<string, string> = {};

export function ColorBg({ emoji }: { emoji?: string }) {
  const [color, setColor] = useState<string>('');

  useEffect(() => {
    if (!emoji) return;

    if (colorCache[emoji]) {
      setColor(colorCache[emoji]);
      return;
    }

    try {
      const emojiColor = getEmojiColor(emoji);
      colorCache[emoji] = emojiColor;
      setColor(emojiColor);
    } catch (error) {
      console.error('Error calculating emoji color:', error);
      setColor('#0000001A');
    }
  }, [emoji]);

  if (!emoji) {
    return (
      <div className="absolute inset-0 z-0 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"></div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      style={{
        background: color
          ? `linear-gradient(to right, ${color}1A, ${color}0A, transparent)`
          : undefined,
      }}
    ></div>
  );
}
