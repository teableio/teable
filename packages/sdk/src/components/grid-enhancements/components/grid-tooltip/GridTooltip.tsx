import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable-group/ui-lib';
import classNames from 'classnames';
import type { FC } from 'react';
import { useGridTooltipStore } from './grid-tooltip';

interface IGridTooltipProps {
  id?: string;
}

export const GridTooltip: FC<IGridTooltipProps> = (props) => {
  const { id } = props;
  const { tooltipInfo } = useGridTooltipStore();
  const visible = Boolean(tooltipInfo) && tooltipInfo?.id === id;
  const { text, position, triggerClassName, triggerStyle, contentClassName, contentStyle } =
    tooltipInfo ?? {};
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
              <div
                className={classNames(
                  'pointer-events-none absolute cursor-pointer',
                  triggerClassName
                )}
                style={{ ...triggerStyle, ...style }}
              />
            </TooltipTrigger>
            <TooltipContent
              sideOffset={8}
              className={classNames(
                'pointer-events-none whitespace-pre-line rounded-none',
                contentClassName
              )}
              style={{
                ...contentStyle,
              }}
            >
              {text}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </>
  );
};
