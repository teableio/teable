import { getRandomString } from '@teable/core';
import { useEffect, useRef, useState } from 'react';
import type { Layout } from 'react-grid-layout';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { Bar } from '../../components/Chart/bar';
import { Chart } from '../../components/Chart/Chart';
import { createChart } from '../../components/Chart/createChart';
import type { Line } from '../../components/Chart/line';
import type { Pie } from '../../components/Chart/pie';

const ReactGridLayout = WidthProvider(Responsive);

class DashboardCharts {
  private initialized = false;

  charts: { [chartId: string]: { instance: Bar | Pie | Line } } = {};

  init() {
    if (this.initialized) {
      return;
    }
    const chartsStr = localStorage.getItem('dashboard-charts');
    if (chartsStr) {
      const chartsJSonMap = JSON.parse(chartsStr);
      Object.keys(chartsJSonMap).forEach((key) => {
        const { type, options, data } = chartsJSonMap[key].instance;
        this.addChart(createChart(type, { options, data }), key);
      });
    }
    this.initialized = true;
  }

  addChart(instance: Bar | Pie | Line, key?: string) {
    this.charts[key || getRandomString(20)] = { instance };
    localStorage.setItem('dashboard-charts', JSON.stringify(this.charts));
  }
}

export const dashboardCharts = new DashboardCharts();

interface ILayout extends Layout {
  chartInstance: Bar | Pie | Line | undefined;
}

export const Dashboard = () => {
  const [layout, setLayout] = useState<ILayout[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dashboardCharts.init();
    const values = Object.values(dashboardCharts.charts);
    const chartLayout = values.map((item, i) => {
      return {
        x: ((values.length + i) * 6) % 12,
        y: 0,
        w: 6,
        h: 12,
        i: i.toString(),
        chartInstance: item.instance,
        static: Math.random() < 0.05,
      };
    });
    setLayout(chartLayout);
    setLoading(false);
  }, []);

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach(() => {
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 200);
      });
    });

    if (dashboardRef.current) {
      resizeObserver.observe(dashboardRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const layoutChange = (_currentLayout: Layout[], allLayouts: ReactGridLayout.Layouts) => {
    const currentLayout = allLayouts['sm'];
    if (!layout.length) {
      return;
    }
    setLayout(
      currentLayout.map((item: Layout, i) => {
        return {
          ...layout[i],
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
          i: item.i,
          static: item.static,
        };
      })
    );
  };
  return (
    <div className="h-full overflow-y-auto" ref={dashboardRef}>
      {!loading && (
        <ReactGridLayout
          layouts={{
            sm: layout,
          }}
          cols={{
            sm: 12,
          }}
          breakpoints={{
            sm: 576,
          }}
          rowHeight={16}
          onLayoutChange={layoutChange}
          useCSSTransforms
          isBounded
        >
          {layout.map((v) => (
            <div className="rounded-lg border border-slate-600" key={v.i}>
              {v.chartInstance && <Chart chartInstance={v.chartInstance} />}
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
};
