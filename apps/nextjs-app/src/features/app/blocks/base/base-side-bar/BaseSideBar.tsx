// import { TableList } from '../../table-list/TableList';
import { CollaboratorType } from '@teable/openapi';
import { useBase } from '@teable/sdk/hooks';
import { BaseNodeTree } from './BaseNodeTree';
import { BasePageRouter } from './BasePageRouter';

export const BaseSideBar = (props: {
  renderWinFreeCredit?: (spaceId: string) => React.ReactNode;
}) => {
  const { renderWinFreeCredit } = props;
  const base = useBase();
  const isSpaceCollaborator = base.collaboratorType === CollaboratorType.Space;
  return (
    <>
      <BasePageRouter />
      {/* <TableList /> */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <BaseNodeTree />
      </div>
      {isSpaceCollaborator && renderWinFreeCredit && renderWinFreeCredit(base.spaceId)}
    </>
  );
};
