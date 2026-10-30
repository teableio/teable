import {
  ChevronDown,
  ChevronUp,
  History,
  Link,
  MoreHorizontal,
  X,
  MessageSquare,
  MessageSquareDot,
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
import type { ReactNode } from 'react';
import { useMeasure } from 'react-use';
import { useTranslation } from '../../context/app/i18n';
import { useCommentPermission, useIsMobile, useTablePermission } from '../../hooks';
import { useRecordCommentCount } from '../comment/hooks';
import { TooltipWrap } from './TooltipWrap';

interface IExpandRecordHeader {
  tableId: string;
  // the records stacked on the way to this one, after the prev / next arrows
  breadcrumb?: ReactNode;
  recordId: string;
  recordHistoryVisible?: boolean;
  commentVisible?: boolean;
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
  onAddToChat?: () => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_OPERATOR_WIDTH = 200;
// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_LABELED_OPERATOR_WIDTH = 600;
// below this a header with a breadcrumb moves copy link and history into the more menu
// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_INLINE_OPERATOR_WIDTH = 480;

const ExpandRecordMoreMenu = ({
  isMobile,
  historyInMenu,
  editable,
  canDelete,
  canDuplicate,
  recordHistoryVisible,
  onCopyUrl,
  onRecordHistoryToggle,
  onDuplicate,
  onAddToChat,
  onDelete,
  onClose,
}: {
  isMobile: boolean;
  // history moves here from the header on a phone, and when the header has no room for it
  historyInMenu: boolean;
  editable: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  recordHistoryVisible?: boolean;
  // set when the header has no room for its copy link button
  onCopyUrl?: () => void;
  onRecordHistoryToggle?: () => void;
  onDuplicate?: () => Promise<void>;
  onAddToChat?: () => void;
  onDelete?: () => Promise<void>;
  onClose?: () => void;
}) => {
  const { t } = useTranslation();
  const showMenu =
    !!onCopyUrl ||
    (historyInMenu && editable && !!onRecordHistoryToggle) ||
    canDelete ||
    (canDuplicate && !!onDuplicate) ||
    !!onAddToChat;
  if (!showMenu) return null;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="size-7 rounded-md px-1.5 hover:bg-accent hover:text-accent-foreground">
        <MoreHorizontal className="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent collisionPadding={isMobile ? 16 : undefined}>
        {onCopyUrl && (
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 text-sm outline-none"
            onClick={onCopyUrl}
          >
            <Link className="size-4 shrink-0" /> {t('expandRecord.copyRecordUrl')}
          </DropdownMenuItem>
        )}
        {historyInMenu && editable && onRecordHistoryToggle && (
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 text-sm outline-none"
            onClick={onRecordHistoryToggle}
          >
            <History className="size-4 shrink-0" />
            {recordHistoryVisible
              ? t('expandRecord.recordHistory.hiddenRecordHistory')
              : t('expandRecord.recordHistory.showRecordHistory')}
          </DropdownMenuItem>
        )}
        {canDuplicate && !!onDuplicate && (
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
        {onAddToChat && (
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 text-sm outline-none"
            onClick={() => {
              onAddToChat();
              setTimeout(() => onClose?.(), 100);
            }}
          >
            <MessageSquareDot className="size-4 shrink-0" /> {t('expandRecord.addToChat')}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 text-sm text-red-500 outline-none hover:text-red-500 focus:text-red-500 aria-selected:text-red-500"
            onClick={async () => {
              await onDelete?.();
              setTimeout(() => onClose?.(), 100);
            }}
          >
            <Trash className="size-4 shrink-0" /> {t('expandRecord.deleteRecord')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const ExpandRecordHeader = (props: IExpandRecordHeader) => {
  const {
    tableId,
    recordId,
    breadcrumb,
    recordHistoryVisible,
    commentVisible,
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
    onAddToChat,
  } = props;

  const permission = useTablePermission();
  const editable = Boolean(permission['record|update']);
  const canDelete = Boolean(permission['record|delete']);
  // Reading comments follows record|read; record|comment only disables the composer.
  const { commentReadable } = useCommentPermission();
  const canDuplicate = Boolean(permission['record|create']);
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const showOperator = width > MIN_OPERATOR_WIDTH;
  // a breadcrumb takes the room the labels would: its header keeps the actions to icons
  const showOperatorLabel = !isMobile && !breadcrumb && width >= MIN_LABELED_OPERATOR_WIDTH;
  const operatorSize = showOperatorLabel ? 'xs' : 'icon-xs';
  const operatorsInMenu = Boolean(breadcrumb) && width < MIN_INLINE_OPERATOR_WIDTH;
  const recordCommentCount = useRecordCommentCount(tableId, recordId, commentReadable);

  // the title lives at the top of the body; the header holds navigation and actions
  return (
    <div
      ref={ref}
      className={cn(
        'flex h-12 w-full items-center border-b border-solid border-border px-4',
        breadcrumb ? 'gap-2' : 'gap-4'
      )}
    >
      {!isMobile && (
        <div className="shrink-0">
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
      )}
      {breadcrumb ? (
        <>
          {!isMobile && <Separator className="h-4" orientation="vertical" />}
          <div className="flex min-w-0 flex-1">{breadcrumb}</div>
        </>
      ) : (
        <div className="flex-1" />
      )}
      {showOperator && (
        <div className="flex items-center gap-1">
          {onCopyUrl && !operatorsInMenu && (
            <TooltipWrap description={t('expandRecord.copyRecordUrl')}>
              <Button variant={'ghost'} size={operatorSize} onClick={onCopyUrl}>
                <Link className="size-4 shrink-0" />
                {showOperatorLabel && t('expandRecord.copyLink')}
              </Button>
            </TooltipWrap>
          )}
          {!isMobile && !operatorsInMenu && editable && onRecordHistoryToggle && (
            <TooltipWrap
              description={
                recordHistoryVisible
                  ? t('expandRecord.recordHistory.hiddenRecordHistory')
                  : t('expandRecord.recordHistory.showRecordHistory')
              }
            >
              <Button
                variant={recordHistoryVisible ? 'secondary' : 'ghost'}
                size={operatorSize}
                onClick={onRecordHistoryToggle}
              >
                <History className="size-4 shrink-0" />
                {showOperatorLabel && t('expandRecord.history')}
              </Button>
            </TooltipWrap>
          )}

          {commentReadable && (
            <TooltipWrap description={t('comment.title')}>
              <Button
                size={operatorSize}
                onClick={onCommentToggle}
                variant={commentVisible ? 'secondary' : 'ghost'}
                className="relative"
              >
                <MessageSquare className="size-4 shrink-0" />
                {showOperatorLabel && t('comment.title')}
                {recordCommentCount ? (
                  <div className="absolute start-4 top-0.5 flex h-3 min-w-3 max-w-5 items-center justify-center rounded-[2px] bg-orange-500 px-0.5 text-[8px] text-white">
                    {recordCommentCount > 99 ? '99+' : recordCommentCount}
                  </div>
                ) : null}
              </Button>
            </TooltipWrap>
          )}

          <ExpandRecordMoreMenu
            isMobile={isMobile}
            historyInMenu={isMobile || operatorsInMenu}
            onCopyUrl={operatorsInMenu ? onCopyUrl : undefined}
            editable={editable}
            canDelete={canDelete}
            canDuplicate={canDuplicate}
            recordHistoryVisible={recordHistoryVisible}
            onRecordHistoryToggle={onRecordHistoryToggle}
            onDuplicate={onDuplicate}
            onAddToChat={onAddToChat}
            onDelete={onDelete}
            onClose={onClose}
          />
        </div>
      )}
      {!isMobile && <Separator className="h-6" orientation="vertical" />}
      <Button variant={'ghost'} size={'icon-xs'} onClick={onClose}>
        <X className="size-4 shrink-0" />
      </Button>
    </div>
  );
};
