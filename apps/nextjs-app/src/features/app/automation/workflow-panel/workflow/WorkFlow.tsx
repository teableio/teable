import { AddActionDropMenu } from '../../components';
import { DraggableAction } from './actions';
import { Trigger } from './Trigger';

const WorkFlow = () => {
  return (
    <div className="h-full pt-10">
      <Trigger></Trigger>
      <DraggableAction></DraggableAction>
      <div className="py-8 pl-[88px]">
        <AddActionDropMenu>
          <div className="mr-1 flex h-16 w-96 cursor-pointer items-center justify-center rounded border-2 border-dashed border-gray-400 hover:opacity-60">
            Add advanced logic or action
          </div>
        </AddActionDropMenu>
      </div>
    </div>
  );
};

export { WorkFlow };
