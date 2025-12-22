import { Edit } from '@teable/icons';
import {
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Textarea,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

interface ITextEditorDialogProps {
  value?: string;
  onChange: (value: string) => void;
  title: string;
  placeholder?: string;
  maxLines?: number;
}

export const TextEditorDialog = ({
  value,
  onChange,
  title,
  placeholder,
  maxLines = 1,
}: ITextEditorDialogProps) => {
  const { t } = useTranslation('common');
  const [innerValue, setInnerValue] = useState(value || '');
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = () => {
    setInnerValue(value || '');
    setIsOpen(true);
  };

  const handleSave = () => {
    onChange(innerValue);
    setIsOpen(false);
  };

  return (
    <>
      <div
        className="group flex size-full cursor-pointer items-center gap-2"
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpen();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <span
          className={cn('flex-1', {
            truncate: maxLines === 1,
            'line-clamp-2': maxLines === 2,
            'line-clamp-3': maxLines === 3,
            'text-gray-500': !value && value !== '0',
          })}
          title={value}
        >
          {value || placeholder || t('untitled')}
        </span>
        <Edit className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              value={innerValue}
              onChange={(e) => setInnerValue(e.target.value)}
              placeholder={placeholder || t('untitled')}
              className="min-h-[200px] resize-none"
            />
            <div className="text-sm text-gray-500">
              {innerValue.length} {t('characters')}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button onClick={handleSave}>{t('actions.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
