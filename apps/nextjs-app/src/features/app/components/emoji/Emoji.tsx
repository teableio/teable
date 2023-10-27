import data from '@emoji-mart/data';
import classNames from 'classnames';
import { init } from 'emoji-mart';
init({ data });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'em-emoji': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        id?: string;
        shortcodes?: string;
        native?: string;
        size?: string | number;
        fallback?: string;
        set?: 'native' | 'apple' | 'facebook' | 'google' | 'twitter';
        skin?: string | number;
      };
    }
  }
}

interface IEmoji {
  className?: string;
  emoji: string;
  size?: number | string;
}

export const Emoji: React.FC<IEmoji> = ({ emoji, size = 24, className }) => {
  return (
    <div className={classNames('w-full h-full flex items-center justify-center', className)}>
      <em-emoji set="native" id={emoji} size={size} />
    </div>
  );
};
