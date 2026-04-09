import { Clock4 } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib';
import { useEffect, useRef } from 'react';

interface ITimePickerProps {
  value: string;
  defaultValue?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  className?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0'));
const ITEM_HEIGHT = 28;

export const TimePicker = ({
  value,
  defaultValue,
  open,
  onOpenChange,
  onChange,
  className,
}: ITimePickerProps) => {
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);

  const displayValue = value || defaultValue || '';
  const [hour, minute] = displayValue ? displayValue.split(':') : ['', ''];

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current && hour && minute) {
      requestAnimationFrame(() => {
        const hourIndex = HOURS.indexOf(hour);
        const minuteIndex = MINUTES.indexOf(minute);
        if (hourIndex >= 0 && hourRef.current) {
          hourRef.current.scrollTop = hourIndex * ITEM_HEIGHT;
        }
        if (minuteIndex >= 0 && minuteRef.current) {
          minuteRef.current.scrollTop = minuteIndex * ITEM_HEIGHT;
        }
      });
    }
    prevOpenRef.current = open;
  }, [open, hour, minute]);

  const handleSelect = (type: 'hour' | 'minute', val: string) => {
    const nextHour = type === 'hour' ? val : hour || '00';
    const nextMinute = type === 'minute' ? val : minute || '00';
    onChange(`${nextHour}:${nextMinute}`);

    requestAnimationFrame(() => {
      const ref = type === 'hour' ? hourRef : minuteRef;
      const items = type === 'hour' ? HOURS : MINUTES;
      const index = items.indexOf(val);
      if (index >= 0 && ref.current) {
        ref.current.scrollTo({ top: index * ITEM_HEIGHT, behavior: 'smooth' });
      }
    });
  };

  return (
    <div role="presentation" className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <Button
        variant="outline"
        className={cn('h-8 gap-1.5 px-2 text-sm', !value && 'text-muted-foreground', className)}
        onClick={() => onOpenChange(!open)}
      >
        <Clock4 className="size-4 text-muted-foreground" />
        {displayValue || '--:--'}
      </Button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 flex h-[200px] rounded-lg border bg-popover shadow-md"
          onWheel={(e) => e.stopPropagation()}
        >
          <div ref={hourRef} className="h-full min-h-0 w-14 overflow-y-auto overscroll-contain p-1">
            {HOURS.map((h) => (
              <button
                type="button"
                key={h}
                className={cn(
                  'flex w-full items-center justify-center rounded-md text-sm',
                  'hover:bg-accent hover:text-accent-foreground',
                  'transition-colors cursor-pointer',
                  h === hour &&
                    'bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground'
                )}
                style={{ height: ITEM_HEIGHT }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect('hour', h)}
              >
                {h}
              </button>
            ))}
          </div>
          <div className="w-px bg-border" />
          <div
            ref={minuteRef}
            className="h-full min-h-0 w-14 overflow-y-auto overscroll-contain p-1"
          >
            {MINUTES.map((m) => (
              <button
                type="button"
                key={m}
                className={cn(
                  'flex w-full items-center justify-center rounded-md text-sm',
                  'hover:bg-accent hover:text-accent-foreground',
                  'transition-colors cursor-pointer',
                  m === minute &&
                    'bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground'
                )}
                style={{ height: ITEM_HEIGHT }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect('minute', m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
