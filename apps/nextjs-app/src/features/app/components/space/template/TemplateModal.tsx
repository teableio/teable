import { useIsMobile } from '@teable/sdk/hooks';
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from '@teable/ui-lib/shadcn';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TemplateDetail } from './TemplateDetail';
import { TemplateMain } from './TemplateMain';
import { TemplateSheet } from './TemplateSheet';
interface TemplateModalProps {
  children: React.ReactNode;
  spaceId: string;
}

export const TemplateModal = (props: TemplateModalProps) => {
  const { children, spaceId } = props;
  const { t } = useTranslation(['space', 'common']);

  const [currentCategoryId, setCurrentCategoryId] = useState<string>('all');

  const [search, setSearch] = useState<string>('');

  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);

  const isMobile = useIsMobile();

  return isMobile ? (
    <TemplateSheet spaceId={spaceId}>{children}</TemplateSheet>
  ) : (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-[85%] max-h-[85%] max-w-[80%] flex-col gap-0 p-0">
        <DialogHeader className="flex w-full border-b p-4">
          <div className="relative flex w-full items-center justify-center gap-2">
            <div className="absolute left-0 flex shrink-0 flex-col gap-0.5">
              <DialogTitle>{t('common:template.title')}</DialogTitle>
              <DialogDescription>{t('common:template.description')}</DialogDescription>
            </div>
            <Input
              placeholder={t('common:settings.templateAdmin.baseSelectPanel.search')}
              value={search}
              className={cn('h-8 w-72', {
                'opacity-0': currentTemplateId,
              })}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </DialogHeader>

        {currentTemplateId ? (
          <TemplateDetail
            templateId={currentTemplateId}
            onBackToTemplateList={() => setCurrentTemplateId(null)}
          />
        ) : (
          <TemplateMain
            currentCategoryId={currentCategoryId}
            search={search}
            onCategoryChange={(value) => setCurrentCategoryId(value)}
            templateListClassName="overflow-y-auto p-2"
            className="w-full"
            onClickTemplateCardHandler={(templateId) => setCurrentTemplateId(templateId)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
