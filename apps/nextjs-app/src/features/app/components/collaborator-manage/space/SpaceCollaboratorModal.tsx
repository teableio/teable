import { useQuery } from '@tanstack/react-query';
import { hasPermission } from '@teable-group/core';
import type { IGetSpaceVo } from '@teable-group/openapi';
import { getSpaceCollaboratorList } from '@teable-group/openapi';
import { Collaborators } from './Collaborators';
import { Invite } from './Invite';
import { InviteLink } from './InviteLink';

interface ISpaceCollaboratorModal {
  space: IGetSpaceVo;
}

export const SpaceCollaboratorModal: React.FC<ISpaceCollaboratorModal> = (props) => {
  const { space } = props;
  const { id: spaceId, role } = space;

  const { data: collaborators } = useQuery({
    queryKey: ['space-collaborator-list', spaceId],
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]).then(({ data }) => data),
  });

  if (!collaborators?.length) {
    return <div>Loading...</div>;
  }

  return (
    <div className="overflow-y-auto">
      <div className="pb-2 text-sm text-muted-foreground">
        This space has <b>{collaborators.length} collaborators</b>. Adding a space collaborator will
        give them access to all bases within this space.
      </div>
      <div className="space-y-8">
        <Invite spaceId={spaceId} role={role} />
        {hasPermission(role, 'space|invite_link') && <InviteLink spaceId={spaceId} role={role} />}
        <Collaborators spaceId={spaceId} role={role} />
      </div>
    </div>
  );
};
