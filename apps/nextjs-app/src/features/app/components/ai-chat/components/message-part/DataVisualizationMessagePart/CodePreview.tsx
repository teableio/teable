import { ScrollArea } from '@teable/ui-lib/shadcn';
import { CopyButton } from '@/features/app/components/CopyButton';
import { Markdown } from '../../common/Markdown';

export const CodePreview = ({ code }: { code?: string }) => {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border shadow-sm">
      <div className="flex h-12 items-center justify-between border-b border-slate-800 bg-gradient-to-r from-slate-800 to-slate-900 px-4">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="size-3 rounded-full bg-red-400"></div>
            <div className="size-3 rounded-full bg-yellow-400"></div>
            <div className="size-3 rounded-full bg-green-400"></div>
          </div>
          <span className="font-mono text-sm text-slate-300">index.html</span>
        </div>
        <CopyButton variant={'ghost'} size="xs" disabled={!code} text={code ?? ''} />
      </div>
      <style>{`
        .data-visualization-code pre {
          background-color: transparent;
          height: 100%;
          padding: 0;
          border-radius: 0 !important;
        }
        .data-visualization-code pre code, .markdown-body pre div {
          height: 100%;
          max-height: 100% !important;
          margin: 0 !important;
          border-radius: 0 !important;
        }
      `}</style>
      <ScrollArea className="flex-1">
        <Markdown
          className="data-visualization-code h-full rounded-none"
          syntaxHighlighterProps={{
            showLineNumbers: true,
            wrapLongLines: true,
            lineProps: () => ({
              style: {
                flexWrap: 'wrap',
              },
            }),
          }}
        >
          {`\`\`\`html${code ?? ''}\`\`\``}
        </Markdown>
      </ScrollArea>
    </div>
  );
};
