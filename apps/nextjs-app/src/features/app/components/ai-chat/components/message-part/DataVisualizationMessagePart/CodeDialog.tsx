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
import { Markdown } from '../../common/Markdown';
import { IFrameLoading } from './IFrameLoading';

export const CodeDialog = ({
  defaultTab = 'preview',
  url,
  code,
  open,
  onOpenChange,
}: {
  defaultTab?: 'preview' | 'code';
  url: string;
  code: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [codeTab, setCodeTab] = useState<'preview' | 'code'>(defaultTab);
  const { t } = useTranslation(['table']);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[70%] max-w-4xl">
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
            {url && <IFrameLoading src={url} className="size-full" title="Data Visualization" />}
          </TabsContent>
          <TabsContent
            value="code"
            className="flex-1 overflow-hidden"
            forceMount
            hidden={codeTab !== 'code'}
          >
            <style>{`
                .data-visualization-code pre {
                  background-color: transparent;
                  height: 100%;
                  padding: 0;
                }
                .data-visualization-code pre code, .markdown-body pre div {
                  height: 100%;
                  max-height: 100% !important;
                }
              `}</style>
            <Markdown className="data-visualization-code h-full ">{`\`\`\`html\n${code ?? ''}\n\`\`\``}</Markdown>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
