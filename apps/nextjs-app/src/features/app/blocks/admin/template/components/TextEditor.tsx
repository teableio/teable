import { Edit } from '@teable/icons';
import { cn, Input } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
interface ITextEditorProps {
  value?: string;
  onChange: (value: string) => void;
  defaultPlaceholder?: string;
  singleLine?: boolean;
  maxLength?: number;
}

export const TextEditor = (props: ITextEditorProps) => {
  const { t } = useTranslation('common');
  const { value, onChange, defaultPlaceholder, singleLine = false, maxLength } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [currentValue, setCurrentValue] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStartEdit = () => {
    setCurrentValue(value || '');
    setIsEditing(true);
    setTimeout(() => {
      inputRef?.current?.focus();
      inputRef?.current?.select();
    }, 0);
  };

  const handleSave = (newValue: string) => {
    if (newValue !== value) {
      onChange(newValue);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  return (
    <div
      className="group flex size-full items-center gap-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isEditing ? (
        <div className="flex flex-1 items-center gap-2">
          <Input
            value={currentValue}
            size={12}
            className="h-8 flex-1"
            maxLength={maxLength}
            onChange={(e) => {
              setCurrentValue(e.target.value);
            }}
            onKeyDown={(e) => {
              const newValue = (e.target as HTMLInputElement).value;
              if (e.key === 'Enter') {
                handleSave(newValue);
              } else if (e.key === 'Escape') {
                handleCancel();
              }
            }}
            onBlur={(e) => {
              const newValue = e.target.value;
              handleSave(newValue);
            }}
            ref={inputRef}
          />
          {maxLength && (
            <span className="shrink-0 text-xs text-gray-500">
              {currentValue.length}/{maxLength}
            </span>
          )}
        </div>
      ) : (
        <span
          className={cn(
            'flex-1 cursor-pointer',
            singleLine ? 'truncate' : 'line-clamp-6 break-words',
            {
              'text-gray-500': !value && value !== '0',
            }
          )}
          title={value}
          role="button"
          tabIndex={0}
          onClick={handleStartEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleStartEdit();
            }
          }}
        >
          {value || defaultPlaceholder || t('untitled')}
        </span>
      )}

      <Edit
        className={cn(
          'size-3 shrink-0 cursor-pointer transition-opacity',
          isHovered || isEditing ? 'opacity-100' : 'opacity-0'
        )}
        onClick={handleStartEdit}
      />
    </div>
  );
};
