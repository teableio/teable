/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import React, { useEffect } from 'react';
import Confetti from 'react-confetti';
import { useMeasure } from 'react-use';

export const ProcessBar: React.FC<{
  onClick: () => void;
  done: boolean;
}> = ({ onClick, done }) => {
  const [ref, { width, height }] = useMeasure<HTMLDivElement>();
  const [taskDone, setTaskDone] = React.useState(false);

  useEffect(() => {
    setTaskDone(done);
    if (done) {
      setTimeout(() => {
        setTaskDone(false);
      }, 2000);
    }
  }, [done]);

  return (
    <div
      ref={ref}
      className="relative w-auto max-w-full bg-base-300 px-2 rounded-lg prose prose-slate text-sm"
      onClick={onClick}
    >
      {taskDone && <Confetti width={width} height={height} />}

      {done ? (
        <div className="px-6 py-3">Successfully created! 🎉</div>
      ) : (
        <>
          ✨ Creating a new table for you...
          <progress className="progress progress-primary w-full"></progress>
        </>
      )}
    </div>
  );
};
