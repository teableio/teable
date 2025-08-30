import type { FunctionName } from '@teable/core';
import { useTheme } from '@teable/next-themes';
import type { IFunctionSchema } from '@teable/openapi';
import { cn } from '@teable/ui-lib';
import type { FC } from 'react';
import { useTranslation } from '../../../../context/app/i18n';

interface IFunctionGuideProps {
  data: Partial<IFunctionSchema<FunctionName>> | null;
}

export const FunctionGuide: FC<IFunctionGuideProps> = (props) => {
  const { data } = props;
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation();

  if (data == null) return null;

  const codeBg = resolvedTheme === 'light' ? 'bg-slate-100' : 'bg-gray-900';

  return (
    <div className="w-full overflow-y-auto">
      <div className="grow px-4 py-2">
        <h2 className="text-lg">{data.name}</h2>
        <div className="text-[13px] text-gray-400">{data.summary}</div>
        {data.definition && (
          <>
            <h3 className="mt-4 text-sm">{t('editor.formula.guideSyntax')}</h3>
            <code
              className={cn('flex mt-2 p-3 w-full rounded text-[13px] whitespace-pre-wrap', codeBg)}
            >
              {data.definition}
            </code>
          </>
        )}
        {data.example && (
          <>
            <h3 className="mt-4 text-sm">{t('editor.formula.guideExample')}</h3>
            <code
              className={cn('flex mt-2 p-3 w-full rounded text-[13px] whitespace-pre-wrap', codeBg)}
            >
              {data.example}
            </code>
          </>
        )}
      </div>
    </div>
  );
};
