import type { FunctionName } from '@teable/core';
import type { IFunctionSchema } from '@teable/openapi';
import type { FC } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { MemoizedContentMarkdownPreview } from '../../../markdown-editor/MarkDownPreview';

interface IFunctionGuideProps {
  data: Partial<IFunctionSchema<FunctionName>> | null;
}

export const FunctionGuide: FC<IFunctionGuideProps> = (props) => {
  const { data } = props;
  const { t } = useTranslation();

  if (data == null) return null;
  return (
    <div className="w-full overflow-y-auto">
      <div className="grow px-4 py-2">
        <h2 className="text-lg">{data.name}</h2>
        <MemoizedContentMarkdownPreview className="px-0 py-0 text-[13px] text-muted-foreground [&_p]:my-0 [&_a]:text-primary [&_a]:underline">
          {data.summary}
        </MemoizedContentMarkdownPreview>
        {data.definition && (
          <>
            <h3 className="mt-4 text-sm">{t('editor.formula.guideSyntax')}</h3>
            <code className="mt-2 flex w-full whitespace-pre-wrap rounded-md bg-surface p-3 text-[13px]">
              {data.definition}
            </code>
          </>
        )}
        {data.example && (
          <>
            <h3 className="mt-4 text-sm">{t('editor.formula.guideExample')}</h3>
            <code className="mt-2 flex w-full whitespace-pre-wrap rounded-md bg-surface p-3 text-[13px]">
              {data.example}
            </code>
          </>
        )}
      </div>
    </div>
  );
};
