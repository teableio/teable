import * as echarts from 'echarts';
import { useCallback, useEffect, useRef } from 'react';
import type { Bar } from './bar';
import type { Line } from './line';
import type { Pie } from './pie';

export const Chart = (props: { chartInstance: Pie | Bar | Line }) => {
  const { chartInstance } = props;
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const renderEcharts = useCallback(
    ({ width, height }: { width: number; height: number }) => {
      if (!chartContainerRef.current) {
        return;
      }
      // eslint-disable-next-line import/namespace
      const myChart = echarts.init(chartContainerRef.current);
      myChart.setOption(chartInstance.getOptions());
      myChart.resize({ width, height });
    },
    [chartInstance]
  );

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        renderEcharts({ width: entry.contentRect.width, height: entry.contentRect.height });
      });
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [chartInstance, renderEcharts]);

  return (
    <div
      ref={chartContainerRef}
      className={'size-full overflow-hidden p-2'}
      style={{ minHeight: '300px', minWidth: '200px' }}
    />
  );
};
