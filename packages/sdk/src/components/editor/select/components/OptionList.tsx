import { useVirtualizer } from '@tanstack/react-virtual';
import { Check } from '@teable/icons';
import { CommandList, CommandItem } from '@teable/ui-lib';
import { useRef } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import type { ISelectOption } from '../../../cell-value';
import { SelectTag } from '../../../cell-value';

interface IOptionListProps {
  options: ISelectOption[];
  checkIsActive: (value: string) => boolean;
  onSelect: (value: string) => void;
}

export const OptionList = (props: IOptionListProps) => {
  const { options, checkIsActive, onSelect } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const rowVirtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 32,
  });

  return (
    <CommandList ref={listRef} className="w-full overflow-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const { index, size, start, key } = virtualItem;
          const option = options[index];

          if (option == null) return null;

          const { label, value, color, backgroundColor } = option;

          return (
            <CommandItem
              key={key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${size}px`,
                transform: `translateY(${start}px)`,
              }}
              value={key.toString()}
              onSelect={() => onSelect?.(value)}
            >
              <SelectTag
                className="truncate"
                label={label || t('common.untitled')}
                backgroundColor={backgroundColor}
                color={color}
              />
              {checkIsActive(value) && <Check className="ml-2 size-4 shrink-0" />}
            </CommandItem>
          );
        })}
      </div>
    </CommandList>
  );
};
