import { useTheme } from '@teable/next-themes';
import { Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';
import { MarkdownPreview } from '@/features/app/components/MarkdownPreview';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';

export const MarkDownEditor = (props: {
  defaultStatus?: 'write' | 'preview';
  value?: string;
  onChange: (value: string) => void;
}) => {
  const { defaultStatus = 'write', value, onChange } = props;
  const { resolvedTheme: currentTheme } = useTheme();
  const { t } = useTranslation(settingPluginConfig.i18nNamespaces);

  useEffect(() => {
    if (currentTheme === 'dark') {
      require('github-markdown-css/github-markdown-dark.css');
    } else {
      require('github-markdown-css/github-markdown-light.css');
    }
  }, [currentTheme]);
  return (
    <div>
      <Tabs defaultValue={defaultStatus}>
        <TabsList className="grid w-56 grid-cols-2">
          <TabsTrigger className="h-full text-xs" value="write">
            {t('plugin:markdown.write')}
          </TabsTrigger>
          <TabsTrigger className="h-full text-xs" value="preview">
            {t('plugin:markdown.preview')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="write">
          <Textarea
            className="h-[200px] max-h-[700px] w-full"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </TabsContent>
        <TabsContent value="preview">
          <MarkdownPreview>{value}</MarkdownPreview>
        </TabsContent>
      </Tabs>
    </div>
  );
};
