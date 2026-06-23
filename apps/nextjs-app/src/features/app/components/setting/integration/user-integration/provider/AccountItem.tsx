import type { IUserIntegrationItemVo } from '@teable/openapi';

/**
 * Generic fallback item: shows the account email when the provider metadata
 * carries one (e.g. Airtable), or just the name for providers this build
 * does not know how to render.
 */
export const AccountItem = ({
  item,
  children,
}: {
  item: IUserIntegrationItemVo;
  children: React.ReactNode;
}) => {
  const userInfo = item.metadata?.userInfo as { email?: string } | undefined;
  return (
    <div className="flex-1 space-y-1">
      {children}
      {userInfo?.email && <div className="text-xs text-muted-foreground">{userInfo.email}</div>}
    </div>
  );
};
