// import { TableList } from '../../table-list/TableList';
import { BaseNodeTree } from './BaseNodeTree';
import { BasePageRouter } from './BasePageRouter';

export const BaseSideBar = () => {
  return (
    <>
      <BasePageRouter />
      {/* <TableList /> */}
      <BaseNodeTree />
    </>
  );
};
