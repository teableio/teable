import { Eye, Edit } from '@teable/icons';
import { MarkDownEditor as MarkdownEditorComponent, MarkdownPreview } from '@teable/sdk';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

interface IMarkdownPreviewButtonProps {
  value?: string;
  onChange: (value: string) => void;
}

export const MarkdownPreviewButton = ({ value, onChange }: IMarkdownPreviewButtonProps) => {
  const { t } = useTranslation('common');
  const [innerValue, setInnerValue] = useState(value || '');
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'edit'>('preview');

  const handleOpen = () => {
    setInnerValue(value || '');
    setActiveTab(value ? 'preview' : 'edit');
    setIsOpen(true);
  };

  const handleSave = () => {
    onChange(innerValue);
    setIsOpen(false);
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen} className="gap-2">
        <Eye className="size-4" />
        {t('actions.view')}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="flex max-h-[80%] min-h-[80%] max-w-[70%] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('settings.templateAdmin.header.markdownDescription')}</DialogTitle>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'preview' | 'edit')}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="w-fit">
              <TabsTrigger value="preview" className="gap-2">
                <Eye className="size-4" />
                {t('actions.preview')}
              </TabsTrigger>
              <TabsTrigger value="edit" className="gap-2">
                <Edit className="size-4" />
                {t('actions.edit')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="preview" className="flex-1 overflow-auto">
              {innerValue ? (
                <MarkdownPreview className="overflow-auto p-4">{innerValue}</MarkdownPreview>
              ) : (
                <div className="flex items-center justify-center p-8 text-gray-500">
                  {t('noDescription')}
                </div>
              )}
            </TabsContent>

            <TabsContent value="edit" className="flex flex-1 overflow-hidden">
              <MarkdownEditorComponent
                value={innerValue}
                onChange={(value) => {
                  setInnerValue(value);
                }}
                autoFocusLastNode
              />
            </TabsContent>
          </Tabs>

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
