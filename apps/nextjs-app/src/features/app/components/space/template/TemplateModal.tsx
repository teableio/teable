import {
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
import { CategoryMenu } from './CategoryMenu';
import { TemplateList } from './TemplateList';
interface TemplateModalProps {
  children: React.ReactNode;
  spaceId: string;
}

export const TemplateModal = (props: TemplateModalProps) => {
  const { children } = props;
  const { t } = useTranslation(['space', 'common']);

  const [currentCategoryId, setCurrentCategoryId] = useState<string>('all');

  const [search, setSearch] = useState<string>('');

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex h-[85%] max-h-[85%] max-w-[80%] flex-col gap-0 p-0">
        <DialogHeader className="flex w-full border-b p-4">
          <div className="relative flex w-full items-center justify-center gap-2">
            <div className="absolute left-0 flex shrink-0 flex-col gap-0.5">
              <DialogTitle>{t('template.title')}</DialogTitle>
              <DialogDescription>{t('template.description')}</DialogDescription>
            </div>
            <Input
              placeholder={t('common:settings.templateAdmin.baseSelectPanel.search')}
              value={search}
              className="h-8 w-72"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </DialogHeader>
        <div className="flex flex-1 overflow-hidden">
          <CategoryMenu
            currentCategoryId={currentCategoryId}
            onCategoryChange={(value) => setCurrentCategoryId(value)}
          />
          <TemplateList currentCategoryId={currentCategoryId} search={search} />
        </div>
      </DialogContent>
    </Dialog>
  );
};
