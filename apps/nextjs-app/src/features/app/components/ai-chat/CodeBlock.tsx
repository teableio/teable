import CopyIcon from '@teable/ui-lib/icons/app/copy.svg';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { syncCopy } from '../../utils/sync-copy';
import type { IChat } from './type';

interface Props {
  chat: IChat;
  language: string;
  value: string;
  onExecute(text?: string): void;
}

export const checkStatementIsSelect = (statement: string) => {
  return statement.toUpperCase().trim().startsWith('SELECT');
};

export const CodeBlock: React.FC<Props> = ({ language, value, onExecute }) => {
  const showExecuteButton = language.toUpperCase() === 'AI';
  const { t } = useTranslation(['table']);

  const copyToClipboard = () => {
    syncCopy(value);
    toast(t('table:table.actionTips.copySuccessful'));
  };

  const handleExecuteQuery = () => {
    onExecute(value);
  };

  return (
    <div className="relative w-full max-w-full font-sans text-sm">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="font-mono text-xs text-white">{language}</span>
        <div className="flex items-center space-x-2">
          <button
            className="flex size-6 items-center justify-center rounded bg-gray-500 bg-none p-1 text-xs text-white opacity-70 hover:opacity-100"
            onClick={copyToClipboard}
          >
            <CopyIcon />
          </button>
          {showExecuteButton && (
            <button
              className="flex size-6 items-center justify-center rounded bg-gray-500 bg-none p-1 text-xs text-white opacity-70 hover:opacity-100"
              onClick={handleExecuteQuery}
            >
              ▶️
            </button>
          )}
        </div>
      </div>
      <SyntaxHighlighter
        language={language.toLowerCase()}
        style={oneDark}
        customStyle={{ margin: 0 }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};
