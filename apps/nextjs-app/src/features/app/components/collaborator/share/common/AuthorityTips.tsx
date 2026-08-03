import { Button } from '@teable/ui-lib/shadcn';
import { ShieldHalf } from 'lucide-react';
import { useTranslation } from 'next-i18next';

interface IAuthorityTipsProps {
  onViewDetail?: () => void;
}
export const AuthorityTips = (props: IAuthorityTipsProps) => {
  const { onViewDetail } = props;
  const { t } = useTranslation('common');
  return (
    <div className="relative flex flex-col gap-2 rounded-lg border bg-surface p-4">
      <div className="flex items-center gap-2">
        <ShieldHalf size={16} />
        <p className="text-sm font-medium">{t('invite.authority.title')}</p>
      </div>
      <p className="pl-6 text-xs text-muted-foreground">{t('invite.authority.description')}</p>
      <Button variant="outline" size="xs" className="absolute right-4 top-2" onClick={onViewDetail}>
        {t('invite.authority.viewDetail')}
      </Button>
    </div>
  );
};
