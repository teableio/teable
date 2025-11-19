import { AlertTriangle } from '@teable/icons';
import { Button, cn, Spin } from '@teable/ui-lib';
import type { EChartsOption } from 'echarts';
import dynamic from 'next/dynamic';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { useBridge, useUiConfig } from '../hooks';

interface BestPracticeChartProps {
  option: EChartsOption;
  className?: string;
  style?: React.CSSProperties;
  theme?: string | object;
  renderer?: 'canvas' | 'svg';
  dragging?: boolean;
  onChartReady?: (chart: echarts.ECharts) => void;
  onError?: (error: Error) => void;
}

const DynamicEChartsWrapper = dynamic(
  () => import('./SimpleEChartsWrapper').then((mod) => ({ default: mod.SimpleEChartsWrapper })),
  {
    ssr: true,
    loading: ({ error }) => {
      if (error) {
        return (
          <div className="flex size-full items-center justify-center">
            <div className="text-xs">{error?.message}</div>
          </div>
        );
      }

      return (
        <div className="flex size-full items-center justify-center">
          <Spin className="size-4" />
        </div>
      );
    },
  }
);

export const Chart: React.FC<BestPracticeChartProps> = (props) => {
  const { className, style, option } = props;
  const { t } = useTranslation('chart');
  const parentBridgeMethods = useBridge();
  const uiConfig = useUiConfig();
  const { isShowingSettings } = uiConfig || {};
  const defaultStyle: React.CSSProperties = {
    width: '100%',
    height: '400px',
    ...style,
  };

  return option ? (
    <div className={cn('relative', className)} style={defaultStyle}>
      <DynamicEChartsWrapper {...props} />
    </div>
  ) : (
    <div className="flex size-full flex-col items-center justify-center gap-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-red-500" />
        <span className="text-sm">{t('chartV2.noData')}</span>
      </div>
      {!isShowingSettings && (
        <Button
          size="sm"
          onClick={() => {
            parentBridgeMethods?.expandPlugin();
          }}
        >
          {t('chartV2.goConfig')}
        </Button>
      )}
    </div>
  );
};
