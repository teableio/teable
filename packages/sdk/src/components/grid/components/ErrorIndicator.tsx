/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { AlertCircle, RefreshCcw, X } from '@teable/icons';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';
import { useTranslation } from '../../../context/app/i18n';
import type { ICellError, IScrollState } from '../interface';
import type { CoordinateManager } from '../managers';

export interface IErrorIndicatorProps {
  cellErrors: ICellError[];
  coordInstance: CoordinateManager;
  scrollState: IScrollState;
}

export const ErrorIndicator = (props: IErrorIndicatorProps) => {
  const { cellErrors, coordInstance, scrollState } = props;
  const { t } = useTranslation();

  if (!cellErrors.length) return null;

  const { scrollLeft, scrollTop } = scrollState;
  const { rowInitSize, freezeColumnCount, freezeRegionWidth, containerWidth, containerHeight } =
    coordInstance;

  return (
    <TooltipProvider delayDuration={100}>
      <div className="pointer-events-none absolute left-0 top-0 z-10">
        {cellErrors.map(({ cellItem, errorMsg, onRetry, onDismiss }) => {
          const [columnIndex, rowIndex] = cellItem;
          const rowHeight = coordInstance.getRowHeight(rowIndex);
          const rowOffset = coordInstance.getRowOffset(rowIndex);
          const columnWidth = coordInstance.getColumnWidth(columnIndex);
          const columnOffset = coordInstance.getColumnRelativeOffset(columnIndex, scrollLeft);

          const y = rowOffset - scrollTop;
          const isFreeze = columnIndex < freezeColumnCount;
          const isColumnVisible =
            isFreeze ||
            (columnOffset + columnWidth - 24 >= freezeRegionWidth &&
              columnOffset <= containerWidth);
          const isRowVisible = y >= rowInitSize - 4 && y <= containerHeight - rowInitSize + 4;

          if (!isColumnVisible || !isRowVisible) return null;

          const key = `error-${columnIndex}-${rowIndex}`;

          return (
            <div
              key={key}
              className="absolute"
              style={{
                left: columnOffset,
                top: rowOffset - scrollTop,
                width: columnWidth,
                height: rowHeight,
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="pointer-events-auto absolute right-1 top-1 cursor-pointer">
                    <div className="relative flex size-6 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                      <AlertCircle className="size-4 text-red-500" />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="end"
                  className="pointer-events-auto max-w-[280px]"
                >
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t('aiError.title')}</p>
                    <p className="break-words text-xs text-muted-foreground">{errorMsg}</p>
                    <div className="flex gap-2 pt-1">
                      {onRetry && (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRetry();
                          }}
                        >
                          <RefreshCcw className="mr-1 size-3" />
                          {t('aiError.retry')}
                        </Button>
                      )}
                      {onDismiss && (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDismiss();
                          }}
                        >
                          <X className="mr-1 size-3" />
                          {t('aiError.dismiss')}
                        </Button>
                      )}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
};
