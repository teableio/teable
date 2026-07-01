import type { Colors } from '@teable/core';
import { COLOR_PALETTE, ColorUtils } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import { getSelectColorPairs } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib/shadcn';

export const ColorPicker = ({
  color,
  onSelect,
  className,
  themeAwareSelectColor,
}: {
  color: Colors;
  onSelect: (color: Colors) => void;
  className?: string;
  themeAwareSelectColor?: boolean;
}) => {
  const { resolvedTheme } = useTheme();
  const getBackgroundColor = (color: Colors) =>
    themeAwareSelectColor
      ? getSelectColorPairs(color, resolvedTheme).backgroundColor
      : ColorUtils.getHexForColor(color);

  return (
    <div className={cn('flex w-fit flex-col px-1', className)}>
      {COLOR_PALETTE.map((group, index) => {
        return (
          <div key={index}>
            {group.map((c) => {
              const bg = getBackgroundColor(c);

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
