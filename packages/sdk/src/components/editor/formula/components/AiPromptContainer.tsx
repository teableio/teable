import { MagicAi, Code, ChevronRight, AlertCircle, Edit } from '@teable/icons';
import { getFormulaPrompt } from '@teable/openapi';
import { Textarea, cn, Button, ScrollArea } from '@teable/ui-lib';
import { TerminalIcon } from 'lucide-react';
import { useEffect, useState, type FC } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import { useFields } from '../../../../hooks';
import { useAIStream } from '../../../../hooks/use-ai';

interface IAiPromptContainerProps {
  onApply: (expression: string) => void;
}

export const AiPromptContainer: FC<IAiPromptContainerProps> = (props) => {
  const { onApply } = props;
  const { t } = useTranslation();
  const fields = useFields({ withHidden: true, withDenied: true });
  const { generateAIResponse, text, loading, error } = useAIStream();
  const [prompt, setPrompt] = useState('');
  const [generatedExpression, setGeneratedExpression] = useState<string>(text);

  useEffect(() => {
    if (text) {
      setGeneratedExpression(text);
    }
  }, [text]);

  const onExpressionGenerate = () => {
    if (!prompt) return;

    generateAIResponse(getFormulaPrompt(prompt, fields));
  };

  const handleApplyAiFormula = () => {
    if (!generatedExpression) return;
    onApply(generatedExpression);
  };

  return (
    <div className="grid h-[360px] grid-cols-2 gap-x-4 p-4">
      <div className="relative flex h-full flex-col overflow-hidden rounded-lg border">
        <div className="flex h-9 items-center gap-2 border-b px-4">
          <Edit className="size-4 text-gray-700 dark:text-gray-400" />
          <span className="text-xs font-medium">{t('editor.formula.inputPrompt')}</span>
        </div>

        <div className="flex grow flex-col gap-y-4 p-4">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('editor.formula.placeholderForAIPrompt')}
            className="grow resize-none"
          />
          <Button
            variant="outline"
            onClick={onExpressionGenerate}
            className="group relative w-full overflow-hidden"
            disabled={!prompt || loading}
            size="sm"
          >
            <MagicAi
              className={cn('size-4 text-gray-700 dark:text-gray-400', loading && 'animate-pulse')}
            />
            {loading ? t('editor.formula.action.generating') : t('editor.formula.action.generate')}
          </Button>
        </div>
      </div>

      <div className="relative flex h-full flex-col overflow-hidden rounded-lg border">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-4">
          <Code className="size-4 text-gray-700 dark:text-gray-400" />
          <span className="text-xs font-medium">{t('editor.formula.generateExpression')}</span>
        </div>

        <div className="grow p-4">
          {!error ? (
            loading && !generatedExpression ? (
              <div className="flex h-full flex-col items-center justify-center gap-y-6">
                <div className="relative flex size-16 items-center justify-center rounded-full">
                  <div className="absolute inset-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
                  <MagicAi className="size-6 animate-pulse text-gray-700 dark:text-gray-400" />
                </div>
                <p className="text-center text-sm text-gray-600">
                  {t('editor.formula.generatingByAI')}
                </p>
              </div>
            ) : generatedExpression ? (
              <div className="flex h-full flex-col gap-y-4">
                <div className="relative grow rounded-md border bg-slate-100 p-3 font-mono dark:bg-zinc-900">
                  <div className="absolute right-2 top-2 rounded-md border px-2 py-0.5 font-sans text-xs text-gray-500">
                    {t('field.title.formula')}
                  </div>
                  <ScrollArea className="mt-6 h-40">
                    <div className="text-[13px]">{generatedExpression}</div>
                  </ScrollArea>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="group shrink-0"
                  onClick={handleApplyAiFormula}
                >
                  <span className="flex items-center">
                    {t('editor.formula.action.apply')}
                    <ChevronRight className="ml-1 size-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Button>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-6">
                <div className="flex size-16 items-center justify-center rounded-full border border-gray-200">
                  <TerminalIcon className="size-6 text-gray-400" />
                </div>
                <p className="max-w-[200px] text-center text-xs text-gray-400">
                  {t('editor.formula.generatedExpressionTips')}
                </p>
              </div>
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-6">
              <AlertCircle className="size-16 text-destructive" />
              <p className="max-w-[200px] text-center text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
