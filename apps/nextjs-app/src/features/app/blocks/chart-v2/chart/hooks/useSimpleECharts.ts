import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseSimpleEChartsOptions {
  theme?: string | object;
  renderer?: 'canvas' | 'svg';
  dragging?: boolean;
}

export const useSimpleECharts = (options?: UseSimpleEChartsOptions) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const prevDraggingRef = useRef(options?.dragging);
  const draggingRef = useRef(options?.dragging);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const initChart = useCallback(() => {
    if (!chartRef.current || !isMounted) {
      return null;
    }

    try {
      const existingInstance = echarts.getInstanceByDom(chartRef.current);
      chartInstanceRef.current = existingInstance
        ? existingInstance
        : echarts.init(chartRef.current, options?.theme, {
            renderer: options?.renderer || 'canvas',
            useDirtyRect: true,
          });

      setIsReady(true);
      return chartInstanceRef.current;
    } catch (error) {
      console.error('ECharts initialization failed:', error);
      setIsReady(false);
      return null;
    }
  }, [isMounted, options?.theme, options?.renderer]);

  const setOption = useCallback((option: EChartsOption) => {
    if (chartInstanceRef.current) {
      try {
        chartInstanceRef.current.setOption(option, true, true);
      } catch (error) {
        console.error('Failed to set chart option:', error);
      }
    }
  }, []);

  const resize = useCallback((opts?: { silent?: boolean; animation?: object }) => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.resize({
        silent: true,
        ...opts,
      });
    }
  }, []);

  const dispose = useCallback(() => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.dispose();
      chartInstanceRef.current = null;
      setIsReady(false);
    }
  }, []);

  useEffect(() => {
    draggingRef.current = options?.dragging;
  }, [options?.dragging]);

  useEffect(() => {
    if (prevDraggingRef.current === true && options?.dragging === false && isReady) {
      const timer = setTimeout(() => {
        resize();
      }, 100);
      return () => clearTimeout(timer);
    }
    prevDraggingRef.current = options?.dragging;
  }, [options?.dragging, isReady, resize]);

  useEffect(() => {
    if (!isReady) return;

    const handleResize = () => {
      if (!draggingRef.current) {
        resize();
      }
    };
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (chartRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (!draggingRef.current) {
          resize();
        }
      });
      resizeObserver.observe(chartRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [isReady, resize]);

  useEffect(() => {
    return () => {
      dispose();
    };
  }, [dispose]);

  return {
    chartRef,
    chartInstance: chartInstanceRef.current,
    initChart,
    setOption,
    resize,
    dispose,
    isReady: isMounted && isReady,
    isMounted,
  };
};
