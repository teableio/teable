import { Edit } from '@teable/icons';
import { DividerRegion } from '@teable/sdk/components/grid/renderers/layout-renderer/interface';
import { cn, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
interface ITextEditorProps {
  value?: string;
  onChange: (value: string) => void;
  defaultPlaceholder?: string;
}

export const TextEditor = (props: ITextEditorProps) => {
  const { t } = useTranslation('common');
  const { value, onChange, defaultPlaceholder } = props;
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex h-full items-center gap-2">
      {isEditing ? (
        <Input
          defaultValue={value}
          size={12}
          className="h-8 w-40"
          onKeyDown={(e) => {
            const newValue = (e.target as HTMLInputElement).value;
            if (e.key === 'Enter') {
              setIsEditing(false);
              onChange(newValue);
            }
          }}
          onBlur={(e) => {
            const newValue = e.target.value;
            if (newValue !== value) {
              onChange(newValue);
            }
            setIsEditing(false);
          }}
          ref={inputRef}
        />
      ) : (
        <span
          className={cn('line-clamp-6 break-words', {
            'text-gray-500': !value && value !== '0',
          })}
          title={value}
        >
          {value || defaultPlaceholder || t('untitled')}
        </span>
      )}

      <Edit
        className="size-3 shrink-0 cursor-pointer"
        onClick={() => {
          setIsEditing(true);

          setTimeout(() => {
            inputRef?.current?.focus();
          }, 100);
        }}
      />
    </div>
  );
};
