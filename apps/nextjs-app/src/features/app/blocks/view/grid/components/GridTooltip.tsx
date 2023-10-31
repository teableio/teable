import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable-group/ui-lib/shadcn';
import { useGridViewStore } from '../store/gridView';

export const GridTooltip = () => {
  const { tooltipInfo } = useGridViewStore();
  const visible = Boolean(tooltipInfo);
  const { text, position } = tooltipInfo ?? {};
  const style = position
    ? {
        left: position.x,
        top: position.y,
        width: position.width,
        height: position.height,
      }
    : {};

  return (
    <>
      {visible ? (
        <TooltipProvider>
          <Tooltip delayDuration={200} open={true}>
            <TooltipTrigger asChild>
              <div className="pointer-events-none absolute cursor-pointer" style={style} />
            </TooltipTrigger>
            <TooltipContent sideOffset={8} className="max-w-xs whitespace-pre-line">
              {text}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </>
  );
};
