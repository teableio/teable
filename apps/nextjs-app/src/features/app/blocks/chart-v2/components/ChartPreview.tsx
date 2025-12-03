import { useTheme } from '@teable/next-themes';
import { cn } from '@teable/ui-lib/shadcn';
import type { EChartsOption } from 'echarts';
import { Chart } from '../chart/Chart';
import { useStorage } from '../hooks';
import { useChartOption } from '../hooks/useChartOption';

interface ChartPreviewProps {
  triggerAnimation?: number;
  dragging?: boolean;
  isShowingSettings?: boolean;
}

export const ChartPreview = ({
  triggerAnimation,
  dragging,
  isShowingSettings,
}: ChartPreviewProps) => {
  const { resolvedTheme } = useTheme();
  const options = useChartOption();
  const { storage } = useStorage();
  const { appearance } = storage;

  return (
    <div
      className={cn('flex flex-1 items-center justify-center border-r min-w-0', {
        'border-none': !isShowingSettings,
      })}
      style={{
        paddingRight: `${appearance?.padding?.right || 0}px`,
        paddingBottom: `${appearance?.padding?.bottom || 0}px`,
        paddingLeft: `${appearance?.padding?.left || 0}px`,
        paddingTop: `${appearance?.padding?.top || 0}px`,
      }}
    >
      <Chart
        key={triggerAnimation}
        option={options as EChartsOption}
        className="size-full"
        style={{ height: '100%' }}
        theme={resolvedTheme}
        dragging={dragging}
      />
    </div>
  );
};
