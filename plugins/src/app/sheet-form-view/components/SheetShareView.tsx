import { useQuery } from '@tanstack/react-query';
import { getShareView } from '@teable/openapi';
import type { IWorkbookData } from '@univerjs/core';
import React from 'react';
import { PreviewPanel } from './sheet/PreviewPanel';

interface ISheetShareViewProps {
  shareId: string;
}

export const SheetShareView = (props: ISheetShareViewProps) => {
  const { shareId } = props;

  const { data: shareView } = useQuery({
    queryKey: ['share_view', shareId],
    queryFn: () => getShareView(shareId).then((res) => res.data),
    enabled: Boolean(shareId),
    // never update after first fetch
    staleTime: Infinity,
  });

  const workBookData = { ...shareView?.extra?.plugin?.storage } as unknown as IWorkbookData;

  return (
    <div className="flex size-full items-start justify-center">
      <PreviewPanel workBookData={workBookData} shareId={shareId} />
    </div>
  );
};
