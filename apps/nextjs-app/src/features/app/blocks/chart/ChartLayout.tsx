import type { IGetBaseVo, ITableVo } from '@teable/openapi';
import { SessionProvider } from '@teable/sdk';
import type { IUser } from '@teable/sdk';
import { AnchorContext, AppProvider, BaseProvider, TableProvider } from '@teable/sdk/context';
import { useRouter } from 'next/router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/features/app/layouts';
import { useSdkLocale } from '../../hooks/useSdkLocale';
import { BasePermissionListener } from '../base/BasePermissionListener';

export const ChartLayout: React.FC<{
  children: React.ReactNode;
  tableServerData: ITableVo[];
  baseServerData: IGetBaseVo;
  user?: IUser;
}> = ({ children, tableServerData, baseServerData, user }) => {
  const router = useRouter();
  const { baseId } = router.query;
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();

  return (
    <AppLayout>
      <AppProvider lang={i18n.language} locale={sdkLocale}>
        <SessionProvider user={user}>
          <AnchorContext.Provider
            value={{
              baseId: baseId as string,
            }}
          >
            <BaseProvider serverData={baseServerData}>
              <BasePermissionListener />
              <TableProvider serverData={tableServerData}>
                <div id="portal" className="relative flex h-screen w-full items-start">
                  {children}
                </div>
              </TableProvider>
            </BaseProvider>
          </AnchorContext.Provider>
        </SessionProvider>
      </AppProvider>
    </AppLayout>
  );
};
