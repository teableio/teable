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
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebounce } from 'react-use';
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

  const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null);

  const [search, setSearch] = useState<string>('');
  const [inputValue, setInputValue] = useState<string>('');

  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Installing leaves for the project it landed in; the catalogue has no business staying open over it.
  useEffect(() => {
    const close = () => setOpen(false);
    router.events.on('routeChangeComplete', close);
    return () => router.events.off('routeChangeComplete', close);
  }, [router.events]);

  const isMobile = useIsMobile();

  // Debounce search input to avoid excessive updates
  useDebounce(
    () => {
      setSearch(inputValue);
    },
    500,
    [inputValue]
  );

  return isMobile ? (
    <TemplateSheet spaceId={spaceId}>{children}</TemplateSheet>
  ) : (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-[88%] max-h-[88%] max-w-[min(80rem,calc(100%-2rem))] flex-col gap-0 p-0 transition-[max-width] duration-300 @container">
        <DialogHeader className="flex w-full border-b p-4">
          <div className="grid w-full items-center gap-3 @4xl:grid-cols-[1fr_auto_1fr]">
            <div className="flex flex-col gap-0.5 text-start">
              <DialogTitle>{t('common:template.title')}</DialogTitle>
              <DialogDescription>{t('common:template.description')}</DialogDescription>
            </div>
            <Input
              placeholder={t('common:template.searchPlaceholder')}
              value={inputValue}
              className={cn('w-full @4xl:w-72', {
                'opacity-0': currentTemplateId,
              })}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
        </DialogHeader>

        {currentTemplateId ? (
          <TemplateDetail
            templateId={currentTemplateId}
            onBackToTemplateList={() => setCurrentTemplateId(null)}
            onTemplateClick={(templateId) => setCurrentTemplateId(templateId)}
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
