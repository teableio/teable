import type { IViewVo } from '@teable-group/core';
import { generateViewId, OpBuilder, ViewType } from '@teable-group/core';
import { useConnection, useTableId, useViews } from '@teable-group/sdk/hooks';
import { useCallback } from 'react';
import type { Doc } from 'sharedb/lib/client';

export function useAddView() {
  const connection = useConnection();
  const tableId = useTableId();
  const views = useViews();
  const maxViewOrder = views.length;
  const viewData: IViewVo = {
    id: generateViewId(),
    name: views[views.length - 1].name + ' ' + views.length,
    type: ViewType.Grid,
  };

  const createDocument = useCallback(
    (collectionId: string, id: string, snapshot: unknown) => {
      console.log('startCreateView');
      const doc = connection.get(collectionId, id);
      return new Promise<Doc>((resolve, reject) => {
        doc.create(snapshot, (error) => {
          if (error) return reject(error);
          console.log(`create view ${collectionId}.${id} succeed!`);
          resolve(doc);
        });
      });
    },
    [connection]
  );

  const createSnapshot = OpBuilder.creator.addView.build(viewData, maxViewOrder);

  return useCallback(() => createDocument(tableId, viewData.id, createSnapshot), []);
}
