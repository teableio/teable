import { useQuery } from '@tanstack/react-query';
import { getViewInstallPlugin } from '@teable/openapi';
import { useView, useTableId } from '@teable/sdk';
import type { IWorkbookData } from '@univerjs/core';
import React from 'react';
import { PreviewPanel } from './excel/PreviewPanel';

interface IExcelShareViewProps {
  shareId: string;
}

export const ExcelShareView = (props: IExcelShareViewProps) => {
  const { shareId } = props;
  const view = useView();
  const viewId = view?.id;
  const tableId = useTableId();

  const { data: pluginInstall } = useQuery({
    queryKey: ['view_plugin', tableId, viewId],
    queryFn: () => getViewInstallPlugin(tableId!, viewId!).then((res) => res.data),
    enabled: Boolean(tableId && viewId),
    // never update after first fetch
    staleTime: Infinity,
  });

  const workBookData = { ...pluginInstall?.storage } as unknown as IWorkbookData;

  return (
    <div className="flex size-full items-start justify-center">
      <PreviewPanel workBookData={workBookData} shareId={shareId} />
    </div>
  );
};
