import emojiData from '@emoji-mart/data';
import EmojiPickerCom from '@emoji-mart/react';
import { useTheme } from '@teable-group/sdk';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';
import type { FC, PropsWithChildren } from 'react';

interface IEmojiPicker {
  className?: string;
  onChange?: (emoji: string) => void;
}

export const EmojiPicker: FC<PropsWithChildren<IEmojiPicker>> = (props) => {
  const { children, className, onChange } = props;
  const { theme } = useTheme();

  const onEmojiSelect = (emoji: { native: string }) => {
    onChange?.(emoji.native);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className={classNames('rounded transition-colors hover:bg-secondary', className)}>
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0">
        <EmojiPickerCom theme={theme} data={emojiData} onEmojiSelect={onEmojiSelect} />
      </PopoverContent>
    </Popover>
  );
};
