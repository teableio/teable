import { Plus } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

export const InviteOrgButton = ({ onClick }: { onClick: () => void }) => {
  const { t } = useTranslation('common');
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Plus className="size-4" />
      {t('invite.addOrgCollaborator.title')}
    </Button>
  );
};
