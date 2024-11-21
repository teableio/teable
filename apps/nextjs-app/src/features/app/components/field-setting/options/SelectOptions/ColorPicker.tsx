import type { Colors } from '@teable/core';
import { COLOR_PALETTE, ColorUtils } from '@teable/core';
import { Button, cn } from '@teable/ui-lib/shadcn';

export const ColorPicker = ({
  color,
  onSelect,
  className,
}: {
  color: Colors;
  onSelect: (color: Colors) => void;
  className?: string;
}) => {
  return (
    <div className={cn('flex w-64 flex-wrap p-2', className)}>
      {COLOR_PALETTE.map((group, index) => {
        return (
          <div key={index}>
            {group.map((c) => {
              const bg = ColorUtils.getHexForColor(c);

              return (
                <Button
                  key={c}
                  variant={'ghost'}
                  className={cn('p-1 my-1 rounded-full h-auto', {
                    'border-2 p-[2px]': color === c,
                  })}
                  style={{ borderColor: bg }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSelect(c);
                  }}
                >
                  <div
                    style={{
                      backgroundColor: bg,
                    }}
                    className="size-4 rounded-full"
                  />
                </Button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
