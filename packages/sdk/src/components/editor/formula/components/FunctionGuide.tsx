import type { FunctionName } from '@teable-group/core/src/formula/functions/common';
import type { FC } from 'react';
import type { IFunctionSchema } from '../interface';

interface IFunctionGuideProps {
  data: Partial<IFunctionSchema<FunctionName>> | null;
}

export const FunctionGuide: FC<IFunctionGuideProps> = (props) => {
  const { data } = props;

  if (data == null) return null;

  return (
    <div className="w-full overflow-y-auto">
      <div className="flex-grow px-4 py-2">
        <h2 className="text-lg">{data.name}</h2>
        <div className="text-[13px] text-gray-400">{data.summary}</div>
        {data.definition && (
          <>
            <h3 className="mt-4 text-sm">Syntax</h3>
            <code
              className={
                'flex mt-2 p-3 w-full rounded text-[13px] whitespace-pre-wrap bg-slate-100 dark:bg-gray-900'
              }
            >
              {data.definition}
            </code>
          </>
        )}
        {data.example && (
          <>
            <h3 className="mt-4 text-sm">Example</h3>
            <code
              className={
                'flex mt-2 p-3 w-full rounded text-[13px] whitespace-pre-wrap bg-slate-100 dark:bg-gray-900'
              }
            >
              {data.example}
            </code>
          </>
        )}
      </div>
    </div>
  );
};
