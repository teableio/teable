import { Emojis } from '@teable/openapi';
import { Button } from '@teable/ui-lib';

interface IEmojiPickerProps {
  onReactionClick: (emoji: string) => void;
}

export const ReactionPicker = (props: IEmojiPickerProps) => {
  const { onReactionClick } = props;

  return (
    <div className="m-1 flex size-full items-center gap-1 bg-card">
      {Emojis.map((emoji) => {
        return (
          <Button
            key={emoji.key}
            variant={'ghost'}
            className="h-auto w-5 select-none p-1 hover:scale-125"
            onClick={() => onReactionClick(emoji.value)}
          >
            {emoji.value}
          </Button>
        );
      })}
    </div>
  );
};
