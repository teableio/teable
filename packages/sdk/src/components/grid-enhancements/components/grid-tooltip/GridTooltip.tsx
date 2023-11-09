import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable-group/ui-lib';
import type { FC } from 'react';
import { useGridTooltipStore } from './grid-tooltip';

interface IGridTooltipProps {
  id?: string;
}

export const GridTooltip: FC<IGridTooltipProps> = (props) => {
  const { id } = props;
  const { tooltipInfo } = useGridTooltipStore();
  const visible = Boolean(tooltipInfo) && tooltipInfo?.id === id;
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
