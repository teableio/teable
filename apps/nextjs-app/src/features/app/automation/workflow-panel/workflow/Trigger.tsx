import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from '@teable/ui-lib';
import { Action } from './actions/Action';

const Trigger = () => {
  return (
    <div className="flex px-2">
      <div
        className={cn(
          'w-12 mr-8 flex relative justify-end',
          'before:block before:absolute before:w-0.5 before:h-full before:bg-gray-300 before:right-0 before:top-0'
        )}
      >
        <div className="z-10 h-4 bg-secondary text-xs text-gray-400">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs">TRIGGER</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>This is the event that sets off automation</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div className="py-2">
        <Action id="test" draggable={false}></Action>
      </div>
    </div>
  );
};

export { Trigger };
