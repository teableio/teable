// import { TableList } from '../../table-list/TableList';
import { useBase } from '@teable/sdk/hooks';
import { useContext } from 'react';
import { TemplateHostContext } from '@/features/app/components/space/template/host-context';
import { BaseNodeTree } from './BaseNodeTree';
import { BasePageRouter } from './BasePageRouter';

export const BaseSideBar = (props: {
  renderWinFreeCredit?: (spaceId: string) => React.ReactNode;
  renderAnnouncementCard?: () => React.ReactNode;
}) => {
  const { renderWinFreeCredit, renderAnnouncementCard } = props;
  const base = useBase();
  const { project: templateProjectHost } = useContext(TemplateHostContext);
  return (
    <>
      {templateProjectHost?.renderSidebarBlock(base)}
      <BasePageRouter />
      {/* <TableList /> */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <BaseNodeTree />
      </div>
      {renderWinFreeCredit && renderWinFreeCredit(base.spaceId)}
      {renderAnnouncementCard && renderAnnouncementCard()}
    </>
  );
};
