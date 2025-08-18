import { useQuery } from '@tanstack/react-query';
import { getPublishedTemplateCategoryList, getPublishedTemplateList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatContainerRef } from '../../components/ai-chat/panel/ChatContainer';
import { PanelContainer } from '../../components/ai-chat/panel/PanelContainer';
import { useChatPanelStore } from '../../components/ai-chat/store/useChatPanelStore';
import { PromptBox } from './PromptBox';
import { Template } from './Template';

const DEFAULT_PANEL_WIDTH = '400px';

export const ChatPage = () => {
  const { t } = useTranslation(['common']);
  const { data: TemplateCategoryList } = useQuery({
    queryKey: ReactQueryKeys.templateCategoryList(),
    queryFn: () => getPublishedTemplateCategoryList().then((data) => data.data),
  });

  const baseId = useBaseId();
  const chatContainerRef = useRef<ChatContainerRef>(null);

  const { isVisible, close, updateWidth } = useChatPanelStore();

  useEffect(() => {
    close();
    updateWidth(DEFAULT_PANEL_WIDTH);
  }, [close, updateWidth]);

  const { data: TemplateList } = useQuery({
    queryKey: ReactQueryKeys.templateList(),
    queryFn: () => getPublishedTemplateList().then((data) => data.data),
  });

  return (
    <div className="flex size-full flex-col overflow-auto">
      <div className="mt-8 flex flex-col justify-center gap-4 py-16 text-center">
        <h1 className={cn('px-4 text-3xl font-bold mt-8 lg:text-5xl md:text-5xl sm:text-4xl')}>
          {t('template.aiTitle')}
        </h1>

        <p className="px-6">{t('template.aiSubTitle')}</p>
      </div>

      <div className="flex h-full flex-col">
        <PromptBox
          onEnter={(text) => {
            chatContainerRef.current?.setInputValue(text);
            setTimeout(() => {
              chatContainerRef.current?.submit();
            }, 100);
          }}
        />
        <Template initialTemplates={TemplateList || []} categories={TemplateCategoryList || []} />
      </div>

      {baseId && (
        <div
          className={cn('fixed top-0 right-0 flex h-full bg-card overflow-hidden max-w-[60%]', {
            'opacity-0 size-0': !isVisible,
            'opacity-100 z-50': isVisible,
          })}
        >
          <PanelContainer ref={chatContainerRef} baseId={baseId} maxWidth="100%" />
        </div>
      )}
    </div>
  );
};
