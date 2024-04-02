import { Progress } from '@teable/ui-lib/shadcn';
import React, { useState, useEffect } from 'react';

export function ProgressBar({ duration, cellCount }: { duration: number; cellCount: number }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!duration) {
      return;
    }
    const interval = 100;
    const step = (interval / duration) * 100;

    const intervalId = setInterval(() => {
      setProgress((prevProgress) => {
        const nextProgress = prevProgress + step;
        return nextProgress > 100 ? 100 : nextProgress;
      });
    }, interval);

    return () => clearInterval(intervalId);
  }, [duration]);

  const format = (count: number) => {
    return Intl.NumberFormat().format(Math.floor(count));
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        Progress: {format((progress / 100) * cellCount)} / {format(cellCount)}
      </p>
      {progress === 100 && (
        <p>Please be patient, the system needs a little more time to process...</p>
      )}
      <Progress value={progress} />
    </div>
  );
}
