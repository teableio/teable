import { ColorUtils, contractColorForTheme, getCollaboratorsChannel } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import type { ICollaboratorUser } from '@teable/sdk';
import { useSession, CollaboratorWithHoverCard } from '@teable/sdk';
import { useConnection } from '@teable/sdk/hooks';
import { cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { chunk, isEmpty } from 'lodash';
import { useRouter } from 'next/router';
import React, { useEffect, useMemo, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';

interface CollaboratorsProps {
  className?: string;
  maxAvatarLen?: number;
}

export const Collaborators: React.FC<CollaboratorsProps> = ({ className, maxAvatarLen = 3 }) => {
  const router = useRouter();
  const { connection } = useConnection();
  const { tableId } = router.query;
  const { user: sessionUser } = useSession();
  const { resolvedTheme } = useTheme();

  const [presence, setPresence] = useState<Presence>();
  const user = useMemo(
    () => ({
      id: sessionUser.id,
      avatar: sessionUser.avatar,
      name: sessionUser.name,
      email: sessionUser.email,
    }),
    [sessionUser]
  );
  const [users, setUsers] = useState<ICollaboratorUser[]>([{ ...user }]);
  const [boardUsers, hiddenUser] = chunk(users, maxAvatarLen);

  useEffect(() => {
    if (!connection || !tableId || !user) {
      return;
    }
    const channel = getCollaboratorsChannel(tableId as string);
    setPresence(connection.getPresence(channel));
    setUsers([{ ...user }]);
  }, [connection, tableId, user]);

  useEffect(() => {
    if (!presence) {
      return;
    }

    const channelTableId = presence.channel.split('_').pop();

    if (presence.subscribed && tableId !== channelTableId) {
      return;
    }

    presence.subscribe();

    const presenceKey = `${tableId}_${user.id}`;
    const localPresence = presence.create(presenceKey);
    localPresence.submit(user, (error) => {
      error && console.error('submit error:', error);
    });

    const receiveHandler = () => {
      let newUser;
      const { remotePresences } = presence;
      if (isEmpty(remotePresences)) {
        newUser = [{ ...user }];
      } else {
        const remoteUsers = Object.values(remotePresences);
        newUser = [{ ...user }, ...remoteUsers];
      }
      setUsers(newUser);
    };

    presence.on('receive', receiveHandler);

    return () => {
      presence.unsubscribe();
      presence?.removeListener('receive', receiveHandler);
    };
  }, [connection, presence, tableId, user]);

  return (
    <div className={cn('gap-1 items-center flex', className)}>
      {boardUsers?.map(({ id, name, avatar, email }) => {
        const borderColor = contractColorForTheme(
          ColorUtils.getRandomHexFromStr(`${tableId}_${id}`),
          resolvedTheme
        );
        return (
          <CollaboratorWithHoverCard
            key={id}
            id={id}
            name={name}
            avatar={avatar}
            email={email}
            borderColor={borderColor}
          />
        );
      })}
      {hiddenUser ? (
        <Popover>
          <PopoverTrigger asChild>
            <div className="relative size-6 shrink-0 grow-0 cursor-pointer select-none overflow-hidden rounded-full border-slate-200">
              <p className="flex size-full items-center justify-center rounded-full border-2 text-center text-xs">
                +{hiddenUser.length}
              </p>
            </div>
          </PopoverTrigger>
          <PopoverContent className="max-h-64 w-36 overflow-y-auto">
            {hiddenUser.map(({ id, name, avatar, email }) => {
              const borderColor = contractColorForTheme(
                ColorUtils.getRandomHexFromStr(`${tableId}_${id}`),
                resolvedTheme
              );
              return (
                <div key={id} className="flex items-center truncate p-1">
                  <CollaboratorWithHoverCard
                    id={id}
                    name={name}
                    avatar={avatar}
                    email={email}
                    borderColor={borderColor}
                  />
                  <div className="flex-1 truncate pl-1">{name}</div>
                </div>
              );
            })}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};
