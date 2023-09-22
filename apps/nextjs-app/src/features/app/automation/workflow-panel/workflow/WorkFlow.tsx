import { AddActionDropMenu } from '../../components';
import { DragableAction } from './actions';
import { Trigger } from './Trigger';

const WorkFlow = () => {
  return (
    <div className="pt-10 h-full">
      <Trigger></Trigger>
      <DragableAction></DragableAction>
      <div className="pl-20 p-2">
        <AddActionDropMenu></AddActionDropMenu>
      </div>
    </div>
  );
};

export { WorkFlow };
