'use client';

import { Table2 } from '@teable/icons';
import { cn, Toggle } from '@teable/ui-lib';
import { useContext, useState } from 'react';
import { useUIConfig } from '../../hooks/useUIConfig';
import { ChartContext } from '../ChartProvider';
import { ChartSetting } from './chart-config/ChartSetting';
import { ChartDisplay } from './chart-show/ChartDisplay';
import { ChartQuery } from './ChartQuery';

export const ChartPage = () => {
  const { tab } = useContext(ChartContext);
  const { isShowingSettings } = useUIConfig();
  const [isTable, setIsTable] = useState(false);
  const { storage } = useContext(ChartContext);
  const hasTable = storage?.config?.type === 'table';

  if (tab === 'query' && isShowingSettings) {
    return <ChartQuery />;
  }

  return (
    <div className="flex size-full">
      <div className="relative flex-1 overflow-hidden">
        <ChartDisplay previewTable={isTable} />
        {!hasTable && isShowingSettings && (
          <Toggle
            size="sm"
            variant="outline"
            pressed={isTable}
            onPressedChange={setIsTable}
            className="absolute bottom-0.5 right-0.5 h-auto p-1.5 data-[state=on]:bg-foreground data-[state=on]:text-background"
            aria-label="Toggle bold"
          >
            <Table2 />
          </Toggle>
        )}
      </div>
      {isShowingSettings && (
        <ChartSetting
          className={cn({
            hidden: !isShowingSettings,
          })}
        />
      )}
    </div>
  );
};
