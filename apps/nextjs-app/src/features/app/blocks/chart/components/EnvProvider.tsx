'use client';
import React from 'react';
import type { IPageParams } from '../types';

export const EnvContext = React.createContext<IPageParams>({} as IPageParams);

export const EnvProvider = (props: { pageParams: IPageParams; children: React.ReactNode }) => {
  const { pageParams, children } = props;
  return <EnvContext.Provider value={pageParams}>{children}</EnvContext.Provider>;
};
