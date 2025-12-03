import { cn } from '@teable/ui-lib';
import type { EChartsOption } from 'echarts';
import { useEffect, useRef, useState } from 'react';
import { useSimpleECharts } from './hooks/useSimpleECharts';

interface SimpleEChartsWrapperProps {
  option: EChartsOption;
  className?: string;
  style?: React.CSSProperties;
  theme?: string | object;
  renderer?: 'canvas' | 'svg';
  dragging?: boolean;
  onChartReady?: (chart: echarts.ECharts) => void;
  onError?: (error: Error) => void;
}

const mapArrayToZero = (items: unknown[]): unknown[] =>
  items.map((child) => mapDataItemToZero(child));

const mapObjectValueToZero = (record: Record<string, unknown>): unknown => {
  if (!('value' in record)) {
    return record;
  }
  const value = record.value;
  if (typeof value === 'number') {
    return { ...record, value: 0 };
  }
  if (Array.isArray(value)) {
    return { ...record, value: mapArrayToZero(value) };
  }
  if (value && typeof value === 'object') {
    return { ...record, value: mapDataItemToZero(value) };
  }
  return record;
};

const mapDataItemToZero = (item: unknown): unknown => {
  if (typeof item === 'number') {
    return 0;
  }
  if (Array.isArray(item)) {
    return mapArrayToZero(item);
  }
  if (item && typeof item === 'object') {
    return mapObjectValueToZero(item as Record<string, unknown>);
  }
  return item;
};

export const SimpleEChartsWrapper: React.FC<SimpleEChartsWrapperProps> = ({
  option,
  className,
  style,
  theme,
  renderer = 'canvas',
  dragging = false,
  onChartReady,
  onError,
}) => {
  const { chartRef, chartInstance, initChart, setOption, isReady, isMounted } = useSimpleECharts({
    theme,
    renderer,
    dragging,
  });
  const [isVisible, setIsVisible] = useState(false);
  const raf1Ref = useRef<number | null>(null);
  const raf2Ref = useRef<number | null>(null);
  const didInitialAnimateRef = useRef(false);
  const onChartReadyRef = useRef(onChartReady);
  const onErrorRef = useRef(onError);
  const hasInitializedRef = useRef(false);

  // Keep callback refs up to date
  useEffect(() => {
    onChartReadyRef.current = onChartReady;
    onErrorRef.current = onError;
  }, [onChartReady, onError]);

  useEffect(() => {
    if (!isMounted) return;
    // Only initialize once, don't re-run when initChart reference changes
    if (hasInitializedRef.current) return;

    const timer = setTimeout(() => {
      try {
        const chart = initChart();
        if (chart && onChartReadyRef.current) {
          onChartReadyRef.current(chart);
        }
        hasInitializedRef.current = true;
        raf1Ref.current = requestAnimationFrame(() => {
          raf2Ref.current = requestAnimationFrame(() => {
            setIsVisible(true);
          });
        });
      } catch (error) {
        console.error('Chart initialization error:', error);
        if (onErrorRef.current) {
          onErrorRef.current(error as Error);
        }
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      if (raf1Ref.current) cancelAnimationFrame(raf1Ref.current);
      if (raf2Ref.current) cancelAnimationFrame(raf2Ref.current);
    };
  }, [isMounted, initChart]);

  useEffect(() => {
    if (dragging || !chartInstance || !option || !isReady) return;

    let animationTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const isPieChart = (() => {
        const rawSeries = (option as { series?: unknown }).series;
        if (!rawSeries) return false;
        const seriesArray = Array.isArray(rawSeries) ? rawSeries : [rawSeries];
        return seriesArray.some((item) => {
          if (!item || typeof item !== 'object') return false;
          return (item as { type?: string }).type === 'pie';
        });
      })();

      if (isPieChart) {
        if (!didInitialAnimateRef.current) {
          chartInstance.setOption(option, true, false);
          didInitialAnimateRef.current = true;
        } else {
          // 后续更新
          setOption(option);
        }
        return;
      }

      if (!didInitialAnimateRef.current) {
        const zeroOption: EChartsOption = (() => {
          try {
            const cloned = JSON.parse(JSON.stringify(option)) as EChartsOption & {
              series?: unknown;
            };
            const rawSeries = (cloned as { series?: unknown }).series;
            if (Array.isArray(rawSeries)) {
              const newSeries = rawSeries.map((s) => {
                if (s && typeof s === 'object') {
                  const sObj = s as Record<string, unknown>;
                  const data = sObj.data as unknown;
                  if (Array.isArray(data)) {
                    const mapped = data.map((v) => mapDataItemToZero(v));
                    return { ...sObj, data: mapped } as Record<string, unknown>;
                  }
                }
                return s;
              });
              (cloned as { series?: unknown }).series = newSeries as unknown;
            }
            return cloned as EChartsOption;
          } catch {
            return option;
          }
        })();

        chartInstance.setOption(zeroOption, true, false);

        animationTimer = setTimeout(() => {
          if (chartInstance) {
            setOption(option);
          }
        }, 50);

        didInitialAnimateRef.current = true;
      } else {
        setOption(option);
      }
    } catch (error) {
      console.error('Chart option setting error:', error);
      if (onErrorRef.current) {
        onErrorRef.current(error as Error);
      }
    }

    return () => {
      if (animationTimer) {
        clearTimeout(animationTimer);
      }
    };
  }, [dragging, chartInstance, option, isReady, setOption]);

  const defaultStyle: React.CSSProperties = {
    width: '100%',
    height: '400px',
    ...style,
  };

  if (!isMounted) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-muted/10 border border-dashed border-muted-foreground/20 rounded-md',
          className
        )}
        style={defaultStyle}
      >
        <div className="text-center">
          <div className="animate-pulse text-muted-foreground">Loading chart...</div>
          <div className="mt-1 text-xs text-muted-foreground/60">Initializing ECharts</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      className={cn(
        'echarts-container',
        !dragging && 'transition-opacity duration-700',
        isVisible ? 'opacity-100' : 'opacity-0',
        className
      )}
      style={{ ...defaultStyle, willChange: dragging ? 'auto' : 'opacity' }}
    />
  );
};
