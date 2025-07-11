import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Input,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { TemplateDetail } from './TemplateDetail';
import { TemplateMain } from './TemplateMain';

interface ITemplateSheetProps {
  children: React.ReactNode;
  spaceId: string;
}

export const TemplateSheet = (props: ITemplateSheetProps) => {
  const { children } = props;
  const { t } = useTranslation(['space', 'common']);

  const [currentCategoryId, setCurrentCategoryId] = useState<string>('all');

  const [search, setSearch] = useState<string>('');

  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="bottom" className="h-[95%]">
        <SheetHeader className="flex w-full border-b p-1">
          <div className="flex w-full items-center justify-start gap-2">
            <div className="left-0 flex flex-1 flex-col gap-1 p-0.5 pr-2">
              <div className="flex gap-2">
                <SheetTitle>{t('common:template.title')}</SheetTitle>
                <Input
                  placeholder={t('common:settings.templateAdmin.baseSelectPanel.search')}
                  value={search}
                  className={cn('h-8 flex-1', {
                    'opacity-0': currentTemplateId,
                  })}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <SheetDescription className="text-start">
                {t('common:template.description')}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

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
            templateListClassName="flex flex-col overflow-y-auto p-2 max-h-[calc(100vh-12rem)]"
            className="w-full"
            onClickTemplateCardHandler={(templateId) => setCurrentTemplateId(templateId)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
};
