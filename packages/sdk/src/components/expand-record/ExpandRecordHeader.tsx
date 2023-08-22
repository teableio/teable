import { ChevronDown, ChevronUp, Link, MessageSquare, X } from '@teable-group/icons';
import { Button, Separator } from '@teable-group/ui-lib';
import classNames from 'classnames';
import { useMeasure } from 'react-use';
import { TooltipWrap } from './TooltipWrap';

interface IExpandRecordHeader {
  title?: string;
  showActivity?: boolean;
  disabledPrev?: boolean;
  disabledNext?: boolean;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onCopyUrl?: () => void;
  onShowActivity?: () => void;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_TITLE_WIDTH = 300;
// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_OPERATOR_WIDTH = 200;

export const ExpandRecordHeader = (props: IExpandRecordHeader) => {
  const {
    title,
    showActivity,
    disabledPrev,
    disabledNext,
    onPrev,
    onNext,
    onClose,
    onCopyUrl,
    onShowActivity,
  } = props;

  const [ref, { width }] = useMeasure<HTMLDivElement>();

  const showTitle = width > MIN_TITLE_WIDTH;
  const showOperator = width > MIN_OPERATOR_WIDTH;

  return (
    <div
      ref={ref}
      className={classNames(
        'w-full h-12 flex items-center gap-4 px-4 border-b border-solid border-border',
        'justify-between' && !showTitle
      )}
    >
      <div>
        <TooltipWrap description="Previous record" disabled={disabledPrev}>
          <Button
            variant={'ghost'}
            tabIndex={-1}
            size={'xs'}
            onClick={onPrev}
            disabled={disabledPrev}
          >
            <ChevronUp />
          </Button>
        </TooltipWrap>
        <TooltipWrap description="Next record" disabled={disabledPrev}>
          <Button
            variant={'ghost'}
            size={'xs'}
            tabIndex={-1}
            onClick={onNext}
            disabled={disabledNext}
          >
            <ChevronDown />
          </Button>
        </TooltipWrap>
      </div>
      {showTitle && (
        <h4
          title={title}
          className="flex-1 scroll-m-20 text-xl font-semibold tracking-tight truncate"
        >
          {title || 'Unnamed record'}
        </h4>
      )}
      {showOperator && (
        <div>
          <TooltipWrap description="Copy record URL" disabled={disabledPrev}>
            <Button variant={'ghost'} size={'xs'} onClick={onCopyUrl}>
              <Link />
            </Button>
          </TooltipWrap>
          <TooltipWrap
            description={`${showActivity ? 'Hide' : 'Show'} activity`}
            disabled={disabledPrev}
          >
            <Button
              variant={showActivity ? 'secondary' : 'ghost'}
              size={'xs'}
              onClick={onShowActivity}
            >
              <MessageSquare />
            </Button>
          </TooltipWrap>
        </div>
      )}
      <Separator className="h-6" orientation="vertical" />
      <Button variant={'ghost'} size={'xs'} onClick={onClose}>
        <X />
      </Button>
    </div>
  );
};
