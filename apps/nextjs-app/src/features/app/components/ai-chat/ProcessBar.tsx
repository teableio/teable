/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import clx from 'classnames';
import React, { useEffect, useMemo } from 'react';
import Confetti from 'react-confetti';
import { useMeasure } from 'react-use';
import { Chart } from '../Chart/Chart';

export const ProcessBar: React.FC<{
  onClick: () => void;
  done: boolean;
  type?: 'chart' | 'table';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedResult?: any;
}> = ({ onClick, done, type, parsedResult }) => {
  const [ref, { width, height }] = useMeasure<HTMLDivElement>();
  const [taskDone, setTaskDone] = React.useState(false);
  const isGenerateChart = type === 'chart';

  useEffect(() => {
    setTaskDone(done);
    if (done) {
      setTimeout(() => {
        setTaskDone(false);
      }, 3000);
    }
  }, [done]);

  const loadingText = useMemo(() => {
    if (isGenerateChart) {
      return <div className="px-2">✨ Generating a chart for you...</div>;
    }
    return <div className="px-2">✨ Performing task for you...</div>;
  }, [isGenerateChart]);

  return (
    <div
      ref={ref}
      className={clx('relative max-w-full bg-base-300 p-1 rounded-lg prose prose-slate text-sm', {
        'w-full': isGenerateChart,
      })}
      onClick={onClick}
    >
      {taskDone && <Confetti width={width} height={height} />}

      {done ? (
        <div className="px-6 py-3">
          Successfully created! 🎉
          {isGenerateChart && parsedResult && (
            <div className="w-full overflow-x-scroll">
              {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */}
              <Chart chartInstance={parsedResult} />
            </div>
          )}
        </div>
      ) : (
        <>
          {loadingText}
          <progress className="progress progress-primary w-full"></progress>
        </>
      )}
    </div>
  );
};
