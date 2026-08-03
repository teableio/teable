// import { TableList } from '../../table-list/TableList';
import { useBase } from '@teable/sdk/hooks';
import { ChangelogNotification } from '@/components/changelog';
import { BaseNodeTree } from './BaseNodeTree';
import { BasePageRouter } from './BasePageRouter';

export const BaseSideBar = (props: {
  renderWinFreeCredit?: (spaceId: string) => React.ReactNode;
}) => {
  const { renderWinFreeCredit } = props;
  const base = useBase();
  return (
    <>
      <BasePageRouter />
      {/* <TableList /> */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <BaseNodeTree />
      </div>
      {renderWinFreeCredit && renderWinFreeCredit(base.spaceId)}
      <ChangelogNotification />
    </>
  );
};
