import { Edit } from '@teable/icons';
import { MarkDownEditor as MarkdownEditorComponent, MarkdownPreview } from '@teable/sdk';
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Button,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

interface IMarkdownEditorProps {
  value?: string;
  onChange: (value: string) => void;
}

export const MarkdownEditor = ({ value, onChange }: IMarkdownEditorProps) => {
  const { t } = useTranslation('common');
  const [innerValue, setInnerValue] = useState(value || '');
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="flex w-full items-center gap-2 overflow-hidden">
      <div
        className={cn('overflow-auto', {
          'flex-1': value || value === '0',
        })}
      >
        {value || value === '0' ? (
          <MarkdownPreview className="max-h-40 overflow-auto">{value}</MarkdownPreview>
        ) : (
          <span className="px-3 py-2 text-sm text-gray-500">{t('noDescription')}</span>
        )}
      </div>

      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogTrigger>
          <Edit
            className="size-3 shrink-0 cursor-pointer"
            onClick={() => {
              setInnerValue(value || '');
            }}
          />
        </DialogTrigger>
        <DialogContent className="flex max-h-[80%] min-h-[80%] max-w-[70%] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('actions.edit')}</DialogTitle>
            <DialogDescription>
              {t('settings.templateAdmin.header.markdownDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-1 gap-4 overflow-hidden">
            <MarkdownEditorComponent
              value={innerValue}
              onChange={(value) => {
                setInnerValue(value);
              }}
              autoFocusLastNode
            />
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                onChange(innerValue);
                setIsEditing(false);
              }}
            >
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
