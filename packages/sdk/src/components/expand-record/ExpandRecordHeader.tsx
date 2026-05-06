import {
  ChevronDown,
  ChevronUp,
  History,
  Link,
  MoreHorizontal,
  X,
  MessageSquare,
} from '@teable/icons';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Separator,
} from '@teable/ui-lib';
import { CopyPlus, Trash } from 'lucide-react';
import { useMeasure } from 'react-use';
import { useTranslation } from '../../context/app/i18n';
import { useTablePermission } from '../../hooks';
import { useRecordCommentCount } from '../comment/hooks';
import { TooltipWrap } from './TooltipWrap';

interface IExpandRecordHeader {
  tableId: string;
  recordId: string;
  title?: string;
  recordHistoryVisible?: boolean;
  commentVisible?: boolean;
  foreignTableName?: string;
  disabledPrev?: boolean;
  disabledNext?: boolean;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onCopyUrl?: () => void;
  onRecordHistoryToggle?: () => void;
  onCommentToggle?: () => void;
  onDelete?: () => Promise<void>;
  onDuplicate?: () => Promise<void>;
  onForeignTableClick?: () => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_TITLE_WIDTH = 300;
// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_OPERATOR_WIDTH = 200;

export const ExpandRecordHeader = (props: IExpandRecordHeader) => {
  const {
    tableId,
    recordId,
    title,
    recordHistoryVisible,
    commentVisible,
    foreignTableName,
    disabledPrev,
    disabledNext,
    onPrev,
    onNext,
    onClose,
    onCopyUrl,
    onRecordHistoryToggle,
    onCommentToggle,
    onDelete,
    onDuplicate,
    onForeignTableClick,
  } = props;

  const permission = useTablePermission();
  const editable = Boolean(permission['record|update']);
  const canRead = Boolean(permission['record|read']);
  const canDelete = Boolean(permission['record|delete']);
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const { t } = useTranslation();
  const showTitle = width > MIN_TITLE_WIDTH;
  const showOperator = width > MIN_OPERATOR_WIDTH;
  const recordCommentCount = useRecordCommentCount(tableId, recordId, canRead);

  return (
    <div
      ref={ref}
      className={cn(
        'w-full flex items-center gap-4 px-4 border-b border-solid border-border',
        foreignTableName ? 'h-14' : 'h-12',
        { 'justify-between': !showTitle }
      )}
    >
      <div>
        <TooltipWrap description="Previous record" disabled={disabledPrev}>
          <Button
            variant={'ghost'}
            tabIndex={-1}
            size={'icon-xs'}
            onClick={onPrev}
            disabled={disabledPrev}
          >
            <ChevronUp className="size-4 shrink-0" />
          </Button>
        </TooltipWrap>
        <TooltipWrap description="Next record" disabled={disabledNext}>
          <Button
            variant={'ghost'}
            size={'icon-xs'}
            tabIndex={-1}
            onClick={onNext}
            disabled={disabledNext}
          >
            <ChevronDown className="size-4 shrink-0" />
          </Button>
        </TooltipWrap>
      </div>
      {showTitle && (
        <div
          className="min-w-0 flex-1"
          data-link-highlight-target={foreignTableName ? tableId : undefined}
        >
          <h4 title={title} className="scroll-m-20 truncate text-xl font-semibold tracking-tight">
            {title || t('common.unnamedRecord')}
          </h4>
          {foreignTableName && (
            <p className="truncate text-xs text-muted-foreground">
              {t('expandRecord.recordFrom')}{' '}
              {onForeignTableClick ? (
                <button
                  className="cursor-pointer text-primary hover:underline"
                  onClick={onForeignTableClick}
                >
                  {foreignTableName}
                </button>
              ) : (
                <span>{foreignTableName}</span>
              )}
            </p>
          )}
        </div>
      )}
      {showOperator && (
        <div className="flex items-center gap-1">
          <TooltipWrap description={t('expandRecord.copyRecordUrl')}>
            <Button variant={'ghost'} size={'icon-xs'} onClick={onCopyUrl}>
              <Link className="size-4 shrink-0" />
            </Button>
          </TooltipWrap>
          {editable && (
            <TooltipWrap
              description={
                recordHistoryVisible
                  ? t('expandRecord.recordHistory.hiddenRecordHistory')
                  : t('expandRecord.recordHistory.showRecordHistory')
              }
            >
              <Button
                variant={recordHistoryVisible ? 'secondary' : 'ghost'}
                size={'icon-xs'}
                onClick={onRecordHistoryToggle}
              >
                <History className="size-4 shrink-0" />
              </Button>
            </TooltipWrap>
          )}

          {editable && (
            <TooltipWrap description={t('comment.title')}>
              <Button
                size={'icon-xs'}
                onClick={onCommentToggle}
                variant={commentVisible ? 'secondary' : 'ghost'}
                className="relative"
              >
                <MessageSquare className="size-4 shrink-0" />
                {recordCommentCount ? (
                  <div className="absolute left-4 top-0.5 flex h-3 min-w-3 max-w-5 items-center justify-center rounded-[2px] bg-orange-500 px-0.5 text-[8px] text-white">
                    {recordCommentCount > 99 ? '99+' : recordCommentCount}
                  </div>
                ) : null}
              </Button>
            </TooltipWrap>
          )}

          {canDelete ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger className="size-7 rounded-md px-1.5 hover:bg-accent hover:text-accent-foreground">
                <MoreHorizontal className="size-4 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {!!onDuplicate && (
                  <DropdownMenuItem
                    className="flex cursor-pointer items-center gap-2 text-sm outline-none"
                    onClick={async () => {
                      await onDuplicate();
                      setTimeout(() => onClose?.(), 100);
                    }}
                  >
                    <CopyPlus className="size-4 shrink-0" /> {t('expandRecord.duplicateRecord')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="flex cursor-pointer items-center gap-2 text-sm text-red-500 outline-none hover:text-red-500 focus:text-red-500 aria-selected:text-red-500"
                  onClick={async () => {
                    await onDelete?.();
                    setTimeout(() => onClose?.(), 100);
                  }}
                >
                  <Trash className="size-4 shrink-0" /> {t('expandRecord.deleteRecord')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      )}
      <Separator className="h-6" orientation="vertical" />
      <Button variant={'ghost'} size={'icon-xs'} onClick={onClose}>
        <X className="size-4 shrink-0" />
      </Button>
    </div>
  );
};
