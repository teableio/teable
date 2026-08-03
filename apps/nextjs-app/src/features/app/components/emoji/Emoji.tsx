import { cn } from '@teable/ui-lib/shadcn';

interface IEmoji {
  className?: string;
  emoji: string;
  size?: number | string;
}

export const Emoji: React.FC<IEmoji> = ({ emoji, size = 24, className }) => {
  return (
    <div className={cn('w-full h-full flex items-center justify-center', className)}>
      <span
        style={{
          fontFamily:
            'EmojiMart, "Segoe UI Emoji", "Segoe UI Symbol", "Segoe UI", "Apple Color Emoji", "Twemoji Mozilla", "Noto Color Emoji", "Android Emoji"',
          fontSize: typeof size === 'number' ? `${size}px` : size,
        }}
      >
        {emoji}
      </span>
    </div>
  );
};
