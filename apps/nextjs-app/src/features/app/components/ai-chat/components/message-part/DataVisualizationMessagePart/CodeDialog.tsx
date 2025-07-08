import { Code, Eye } from '@teable/icons';
import {
  Dialog,
  DialogContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { CodePreview } from './CodePreview';
import { IFrameLoading } from './IFrameLoading';
import { useCodeBlobPreview } from './useCodeBlobPreview';

export const CodeDialog = ({
  defaultTab = 'preview',
  code,
  open,
  onOpenChange,
}: {
  defaultTab?: 'preview' | 'code';
  code?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [codeTab, setCodeTab] = useState<'preview' | 'code'>(defaultTab);
  const { t } = useTranslation(['table']);
  const url = useCodeBlobPreview(code);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[70%] w-[90%] max-w-7xl">
        <Tabs
          value={codeTab}
          onValueChange={(value) => setCodeTab(value as 'preview' | 'code')}
          className="flex h-full flex-col overflow-hidden"
        >
          <TabsList className="mb-4 w-fit">
            <TabsTrigger value="preview" className="flex items-center gap-2 text-xs">
              <Eye className="size-4" />
              {t('table:aiChat.codeBlock.preview')}
            </TabsTrigger>
            <TabsTrigger value="code" className="flex items-center gap-2 text-xs">
              <Code className="size-4" />
              {t('table:aiChat.codeBlock.code')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="preview" className="flex-1" forceMount hidden={codeTab !== 'preview'}>
            <IFrameLoading src={url} className="size-full" title="Data Visualization" />
          </TabsContent>
          <TabsContent
            value="code"
            className="flex-1 overflow-hidden"
            forceMount
            hidden={codeTab !== 'code'}
          >
            <CodePreview code={code} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
