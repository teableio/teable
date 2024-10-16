'use client';
import { PluginPosition } from '@teable/openapi';
import { useSearchParams } from 'next/navigation';
import React from 'react';
import type { IPageParams } from '../types';

export const EvnContext = React.createContext<IPageParams>(null!);

export const EnvProvider = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const searchParams = useSearchParams();

  return (
    <EvnContext.Provider
      value={{
        lang: searchParams.get('lang') || 'en',
        baseId: searchParams.get('baseId') || '',
        pluginId: searchParams.get('pluginId') || '',
        shareId: searchParams.get('shareId') || undefined,
        pluginInstallId: searchParams.get('pluginInstallId') || '',
        positionId: searchParams.get('positionId') || '',
        tableId: searchParams.get('tableId') || '',
        theme: searchParams.get('theme') || 'light',
        positionType:
          (searchParams.get('positionType') as PluginPosition) || PluginPosition.Dashboard,
      }}
    >
      {children}
    </EvnContext.Provider>
  );
};
