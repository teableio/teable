import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable-group/ui-lib';
import { Action } from './actions/Action';

const Trigger = () => {
  return (
    <div className="flex px-2">
      <div className="w-12 mr-4 flex relative before:block before:absolute before:w-0.5 before:h-full before:bg-primary/20 before:right-0 before:top-0 justify-end">
        <div className="text-xs text-gray-400 h-4 z-10 bg-secondary">
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
      <div className="py-4">
        <Action></Action>
      </div>
    </div>
  );
};

export { Trigger };
