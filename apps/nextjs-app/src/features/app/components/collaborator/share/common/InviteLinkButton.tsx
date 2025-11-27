import { ChevronRight } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

export const InviteLinkButton = ({
  className,
  linkListCount,
  onClick,
}: {
  className?: string;
  linkListCount: number;
  onClick: () => void;
}) => {
  const { t } = useTranslation('common');

  return (
    <Button
      variant="ghost"
      className={cn(
        'flex w-full justify-between font-normal shadow-none',
        linkListCount === 0 && 'text-muted-foreground',
        className
      )}
      onClick={onClick}
    >
      {linkListCount > 0
        ? `${linkListCount} ${t('invite.dialog.linkTitle')}`
        : t('invite.dialog.noInviteLinks')}
      <ChevronRight className="size-4 text-muted-foreground" />
    </Button>
  );
};
