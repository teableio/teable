import { ColorUtils } from '@teable-group/core';
import { getCollaboratorsChannel } from '@teable-group/core/dist/models/channel';
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
import { isEmpty, isEqual, chunk } from 'lodash';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';

interface CollaboratorsProps {
  className?: string;
  maxAvatarLen?: number;
}

type ICollaboratorUser = Pick<IUser, 'id' | 'avatar' | 'name'>;

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
    }),
    [sessionUser]
  );
  const [users, setUsers] = useState<ICollaboratorUser[]>([{ ...user }]);
  const [boardUsers, hiddenUser] = chunk(users, maxAvatarLen);

  useEffect(() => {
    const channel = getCollaboratorsChannel(tableId as string);
    setPresence(connection.getPresence(channel));
    setUsers([{ ...user }]);
  }, [connection, tableId, user]);

  useEffect(() => {
    return () => {
      presence?.unsubscribe();
    };
  }, [presence]);

  useEffect(() => {
    if (!presence) {
      return;
    }

    const receiveHandler = () => {
      let newUser;
      const { remotePresences } = presence;
      if (isEmpty(remotePresences)) {
        newUser = [{ ...user }];
      } else {
        const remoteUsers = Object.values(remotePresences);
        newUser = [{ ...user }, ...remoteUsers];
      }
      if (!isEqual(newUser, users)) {
        setUsers(newUser);
      }
    };

    const [, , , , channelTableId] = presence.channel.split('_');
    if (tableId === channelTableId) {
      presence.subscribe();
      const localPresence = presence.create(`${tableId}_${user.id}`);
      localPresence.submit(user, (error) => {
        if (error) {
          console.error('submit error:', error);
        }
      });
      presence.on('receive', receiveHandler);
    }

    return () => {
      if (tableId === channelTableId) {
        presence.removeListener('receive', receiveHandler);
      }
    };
  }, [presence, tableId, user, users]);

  const avatarRender = ({ name, avatar, id }: ICollaboratorUser) => {
    const borderColor = ColorUtils.getRandomHexFromStr(`${tableId}_${id}`);
    return (
      <Avatar
        className="box-content h-7 w-7 cursor-pointer border"
        style={{
          borderColor: borderColor,
        }}
      >
        <AvatarImage src={avatar as string} alt="avatar-name" />
        <AvatarFallback className="text-sm">{name.slice(0, 1)}</AvatarFallback>
      </Avatar>
    );
  };

  return (
    <div className={classNames('gap-1 px-2 items-center hidden sm:flex', className)}>
      {boardUsers?.map(({ id, name, avatar }) => {
        return (
          <HoverCard key={id}>
            <HoverCardTrigger asChild>
              <div className="relative overflow-hidden">{avatarRender({ id, name, avatar })}</div>
            </HoverCardTrigger>
            <HoverCardContent className="flex w-36 justify-center truncate p-4 text-sm">
              <span>{name}</span>
              <span className="pl-1">{id === user.id ? '(You)' : null}</span>
            </HoverCardContent>
          </HoverCard>
        );
      })}
      {hiddenUser ? (
        <Popover>
          <PopoverTrigger asChild>
            <div className="relative shrink-0 grow-0 cursor-pointer select-none overflow-hidden rounded-full border border-slate-200">
              <p className="flex h-7 w-7 items-center justify-center text-center text-sm">
                +{hiddenUser.length}
              </p>
            </div>
          </PopoverTrigger>
          <PopoverContent className="max-h-64 w-36 overflow-y-auto">
            {hiddenUser.map(({ id, name, avatar }) => (
              <div key={id} className="flex items-center truncate p-1">
                {avatarRender({ id, name, avatar })}
                <div className="flex-1 truncate pl-1">{name}</div>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};
