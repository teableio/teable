'use client';
import { useSearchParams } from 'next/navigation';
import React from 'react';

export const EvnContext = React.createContext({
  lang: 'en',
  baseId: '',
  dashboardId: '',
  shareId: '',
  tableId: '',
  pluginId: '',
  pluginInstallId: '',
});

export const EnvProvider = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const searchParams = useSearchParams();

  return (
    <EvnContext.Provider
      value={{
        lang: searchParams.get('lang') || 'en',
        baseId: searchParams.get('baseId') || '',
        dashboardId: searchParams.get('dashboardId') || '',
        pluginId: searchParams.get('pluginId') || '',
        shareId: searchParams.get('shareId') || '',
        tableId: searchParams.get('tableId') || '',
        pluginInstallId: searchParams.get('pluginInstallId') || '',
      }}
    >
      {children}
    </EvnContext.Provider>
  );
};
