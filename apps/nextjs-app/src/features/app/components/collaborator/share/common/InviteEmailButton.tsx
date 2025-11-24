import { useTranslation } from 'next-i18next';

export const InviteEmailButton = ({ onClick }: { onClick: () => void }) => {
  const { t } = useTranslation('common');
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="flex h-9 cursor-pointer items-center rounded-md border border-input px-3 text-sm text-muted-foreground hover:bg-accent"
      onClick={onClick}
    >
      {t('invite.dialog.tabEmail')}
    </div>
  );
};
