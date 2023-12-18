import { ColorUtils, getCollaboratorsChannel } from '@teable-group/core';
import { useSession } from '@teable-group/sdk';
import type { IUser } from '@teable-group/sdk';
import { useConnection } from '@teable-group/sdk/hooks';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import { isEmpty, chunk } from 'lodash';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';

interface CollaboratorsProps {
  className?: string;
  maxAvatarLen?: number;
}

type ICollaboratorUser = Omit<IUser, 'phone' | 'notifyMeta'>;

export const Collaborators: React.FC<CollaboratorsProps> = ({ className, maxAvatarLen = 3 }) => {
  const router = useRouter();
  const { connection } = useConnection();
  const { nodeId: tableId } = router.query;
  const { user: sessionUser } = useSession();
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
    if (!connection?.id || !tableId || !user) {
      return;
    }
    const channel = getCollaboratorsChannel(tableId as string);
    setPresence(connection.getPresence(channel));
    setUsers([{ ...user }]);
  }, [connection, connection?.id, tableId, user]);

  useEffect(() => {
    if (!presence) {
      return;
    }

    const channelTableId = presence.channel.split('_').pop();

    if (presence.subscribed && tableId !== channelTableId) {
      return;
    }

    presence.subscribe();

    const presenceKey = `${tableId}_${user.id}_${connection.id}`;
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
  }, [connection, presence, tableId, user, connection?.id]);

  const avatarRender = ({ name, avatar, id }: ICollaboratorUser) => {
    const borderColor = ColorUtils.getRandomHexFromStr(`${tableId}_${id}`);
    return (
      <Avatar
        className="h-6 w-6 cursor-pointer border-2"
        style={{
          borderColor: borderColor,
        }}
      >
        <AvatarImage src={avatar as string} alt={`${name} avatar`} />
        <AvatarFallback className="text-sm leading-6">{name.slice(0, 1)}</AvatarFallback>
      </Avatar>
    );
  };

  return (
    <div className={classNames('gap-1 px-2 items-center hidden sm:flex', className)}>
      {boardUsers?.map(({ id, name, avatar, email }, index) => {
        return (
          <HoverCard key={`${id}_${index}`}>
            <HoverCardTrigger asChild>
              <div className="relative overflow-hidden">
                {avatarRender({ id, name, avatar, email })}
              </div>
            </HoverCardTrigger>
            <HoverCardContent className="flex w-max max-w-[160px] flex-col justify-center truncate p-2 text-sm">
              <div className="truncate">
                <span>{name}</span>
                <span className="pl-1">{id === user.id ? '(You)' : null}</span>
              </div>
              <div className="truncate">
                <span>{email}</span>
              </div>
            </HoverCardContent>
          </HoverCard>
        );
      })}
      {hiddenUser ? (
        <Popover>
          <PopoverTrigger asChild>
            <div className="relative h-6 w-6 shrink-0 grow-0 cursor-pointer select-none overflow-hidden rounded-full border-slate-200">
              <p className="flex h-full w-full items-center justify-center rounded-full border-2 text-center text-xs">
                +{hiddenUser.length}
              </p>
            </div>
          </PopoverTrigger>
          <PopoverContent className="max-h-64 w-36 overflow-y-auto">
            {hiddenUser.map(({ id, name, avatar, email }) => (
              <div key={id} className="flex items-center truncate p-1">
                {avatarRender({ id, name, avatar, email })}
                <div className="flex-1 truncate pl-1">{name}</div>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};
