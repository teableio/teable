import { ColorUtils } from '@teable-group/core';
import { getCellCollaboratorsChannel } from '@teable-group/core/dist/models/channel';
import { useSession } from '@teable-group/sdk';
import { SelectionRegionType } from '@teable-group/sdk/components/grid';
import type { ICollaborator, CombinedSelection } from '@teable-group/sdk/components/grid';
import { useConnection, useTableId } from '@teable-group/sdk/hooks';
import { useEffect, useState, useMemo } from 'react';
import type { Presence } from 'sharedb/lib/sharedb';

export const useCollaborate = (selection?: CombinedSelection) => {
  const { user } = useSession();
  const tableId = useTableId();
  const { connection } = useConnection();
  const [collaborators, setCollaborators] = useState<ICollaborator>([]);
  const [presence, setPresence] = useState<Presence>();
  const activeCell = useMemo(() => {
    if (selection?.type === SelectionRegionType.Cells) {
      return selection?.ranges?.[0];
    }
    return null;
  }, [selection]);

  useEffect(() => {
    const receiveHandler = () => {
      if (presence?.remotePresences) {
        setCollaborators(Object.values(presence?.remotePresences));
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
  }, [presence, setCollaborators]);

  useEffect(() => {
    if (tableId) {
      const channel = getCellCollaboratorsChannel(tableId);
      setPresence(connection.getPresence(channel));
    }
  }, [connection, tableId]);

  const localPresence = useMemo(() => {
    if (presence) {
      return presence.create(`${tableId}_${user.id}`);
    }
    return null;
  }, [presence, tableId, user.id]);

  useEffect(() => {
    if (!presence || !localPresence) {
      return;
    }
    if (!activeCell) {
      // if want to collaborate the same user in different tab, create with connectionId
      localPresence?.submit(null, (error) => {
        error && console.error('submit error:', error);
      });
    } else {
      const [col, row] = activeCell;
      localPresence.submit(
        {
          user: user,
          activeCell: [col, row],
          borderColor: ColorUtils.getRandomHexFromStr(`${tableId}_${user.id}`),
        },
        (error) => {
          error && console.error('submit error:', error);
        }
      );
    }
  }, [activeCell, connection, localPresence, presence, tableId, user]);

  return [collaborators];
};
