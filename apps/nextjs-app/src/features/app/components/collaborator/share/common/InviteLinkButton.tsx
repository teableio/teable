import { ChevronRight } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

export const InviteLinkButton = ({
  linkListCount,
  onClick,
}: {
  linkListCount: number;
  onClick: () => void;
}) => {
  const { t } = useTranslation('common');

  return (
    <Button
      variant="outline"
      className="flex w-full justify-between border-none font-normal shadow-none"
      onClick={onClick}
    >
      {linkListCount > 0
        ? `${linkListCount} ${t('invite.dialog.linkTitle')}`
        : t('invite.dialog.noInviteLinks')}
      <ChevronRight className="size-4" />
    </Button>
  );
};
