import { ColorUtils, getCellCollaboratorsChannel } from '@teable/core';
import type { ICellItem, ICell } from '@teable/sdk';
import { useSession } from '@teable/sdk';
import { SelectionRegionType } from '@teable/sdk/components/grid';
import type { ICollaborator, CombinedSelection } from '@teable/sdk/components/grid';
import { useConnection, useTableId, useViewId } from '@teable/sdk/hooks';
import { useEffect, useState, useMemo } from 'react';
import type { Presence } from 'sharedb/lib/sharedb';

export const useCollaborate = (
  selection: CombinedSelection | undefined,
  getCellContent: (cell: ICellItem) => ICell
) => {
  const tableId = useTableId();
  const { user } = useSession();
  const viewId = useViewId();
  const { connection } = useConnection();
  const [presence, setPresence] = useState<Presence>();
  const [collaborators, setCollaborators] = useState<ICollaborator>([]);
  const activeCell = useMemo(() => {
    if (selection?.type === SelectionRegionType.Cells) {
      return selection?.ranges?.[0];
    }
    return null;
  }, [selection]);

  const localPresence = useMemo(() => {
    if (presence && connection?.id) {
      return presence.create(`${tableId}_${user.id}_${connection.id}`);
    }
    return null;
  }, [connection?.id, presence, tableId, user.id]);

  useEffect(() => {
    if (!tableId || !connection || !viewId) {
      return;
    }
    // reset collaborators when table or view have been changed
    setCollaborators([]);
    const channel = getCellCollaboratorsChannel(tableId);
    setPresence(connection.getPresence(channel));
  }, [connection, tableId, viewId]);

  useEffect(() => {
    const receiveHandler = () => {
      if (presence?.remotePresences) {
        setCollaborators(Object.values(presence.remotePresences));
      }
    };

    if (presence) {
      presence.subscribe();
      presence.on('receive', receiveHandler);
    }

    return () => {
      presence?.unsubscribe();
      presence?.removeListener('receive', receiveHandler);
    };
  }, [presence]);

  useEffect(() => {
    if (!localPresence) {
      return;
    }
    if (!activeCell) {
      /**
       * if want to collaborate the same user in different tab, create with connectionId
       * reset presence data to null
       **/
      localPresence?.submit(null, (error) => {
        error && console.error('submit error:', error);
      });
    } else {
      const activeCellId = getCellContent(activeCell)?.id;
      activeCellId?.length &&
        localPresence.submit(
          {
            user: {
              id: user.id,
              name: user.name,
              avatar: user.avatar,
              email: user.email,
            },
            activeCellId: activeCellId,
            borderColor: ColorUtils.getRandomHexFromStr(`${tableId}_${user.id}`),
            timeStamp: Date.now(),
          },
          (error) => {
            error && console.error('submit error:', error);
          }
        );
    }
    // not include getCellContent, because it will be changed frequently
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCell, localPresence, tableId, user]);

  return collaborators;
};
