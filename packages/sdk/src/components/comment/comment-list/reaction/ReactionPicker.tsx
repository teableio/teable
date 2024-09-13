import { Button } from '@teable/ui-lib';

const Emojis = [
  {
    key: 'thumbsup',
    value: `👍`,
    unified: '1f44d',
    unifiedWithoutSkinTone: '1f44d',
  },
  {
    key: 'smile',
    value: '😄',
    unified: '1f604',
    unifiedWithoutSkinTone: '1f604',
  },
  {
    key: 'heart',
    value: `❤️`,
    unified: '2764-fe0f',
    unifiedWithoutSkinTone: '2764-fe0f',
  },
  {
    key: 'eyes',
    value: `👀`,
    unified: '1f440',
    unifiedWithoutSkinTone: '1f440',
  },
  {
    key: 'rocket',
    value: `🚀`,
    unified: '1f680',
    unifiedWithoutSkinTone: '1f680',
  },
  {
    key: 'tada',
    value: `🎉`,
    unified: '1f389',
    unifiedWithoutSkinTone: '1f389',
  },
];

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
