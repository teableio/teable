import { MemoizedContentMarkdownPreview, type Components } from '@teable/sdk';
import { cn } from '@teable/ui-lib/shadcn';
import { ExternalLink, ChevronDown } from 'lucide-react';
import { marked } from 'marked';
import { useTranslation } from 'next-i18next';
import React, { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

const parseMarkdownIntoBlocks = (markdown: string): string[] => {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
};

const NonMemoizedMarkdown = ({
  id,
  children,
  className,
  components,
}: {
  id?: string;
  children: string;
  className?: string;
  components?: Components;
}) => {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children]);

  return blocks.map((block, index) => (
    <MemoizedContentMarkdownPreview
      key={`${id || ''}-block_${index}`}
      className={cn('px-0 py-0 !text-[13px]', className)}
      components={{
        code(props) {
          const { children, className, ...rest } = props;
          const match = /language-(\w+)/.exec(className || '');
          const isHtml = match && match[1].toLowerCase() === 'html';

          if (isHtml) {
            return (
              <HtmlCodeBlock
                code={String(children).replace(/\n$/, '')}
                className={className}
                {...rest}
              />
            );
          }

          return match ? (
            <SyntaxHighlighter
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {...(rest as any)}
              PreTag="div"
              // eslint-disable-next-line react/no-children-prop
              children={String(children).replace(/\n$/, '')}
              language={match[1]}
              style={oneDark}
              customStyle={{
                maxHeight: '500px',
              }}
            />
          ) : (
            <code {...rest} className={className}>
              {children}
            </code>
          );
        },
        p(props) {
          const { children } = props;
          const content = String(children).trim();
          if (content === 'EOF' || content === '"EOF"') {
            return null;
          }
          return (
            // eslint-disable-next-line tailwindcss/enforces-shorthand
            <p className="!mb-2 !mt-2">{children}</p>
          );
        },
        a(props) {
          const { children, href, ...rest } = props;
          return (
            <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
        ...components,
      }}
    >
      {block}
    </MemoizedContentMarkdownPreview>
  ));
};

const MAX_VISIBLE_LINES = 25;

const isHtmlComplete = (html: string): boolean => {
  const hasHtmlTags = html.includes('<html') && html.includes('</html>');
  const htmlEndPos = html.toLowerCase().lastIndexOf('</html>');
  const isEndNearby = htmlEndPos > 0 && html.length - htmlEndPos < 20;

  return hasHtmlTags && isEndNearby;
};

const HtmlCodeBlockInner = ({ code, ...rest }: { code: string; className?: string }) => {
  const [activeTab, setActiveTab] = useState<string>('code');
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showAllCode, setShowAllCode] = useState(false);
  const [htmlComplete, setHtmlComplete] = useState(false);
  const { t } = useTranslation(['table']);

  const codeLines = useMemo(() => code.split('\n'), [code]);
  const isTruncated = codeLines.length > MAX_VISIBLE_LINES;

  const visibleCode = useMemo(() => {
    if (!isTruncated || showAllCode) return code;
    return codeLines.slice(-MAX_VISIBLE_LINES).join('\n');
  }, [code, codeLines, isTruncated, showAllCode]);

  const hiddenLinesCount = isTruncated ? codeLines.length - MAX_VISIBLE_LINES : 0;

  const blobUrl = useMemo(() => {
    if (activeTab === 'preview') {
      const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
      return URL.createObjectURL(blob);
    }
    return null;
  }, [code, activeTab]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  const handleTabChange = useCallback(
    (value: string) => {
      setActiveTab(value);
      if (value === 'preview' && !iframeLoaded) {
        setIframeLoaded(true);
      }
    },
    [iframeLoaded]
  );

  const openInNewTab = useCallback(() => {
    if (blobUrl) {
      window.open(blobUrl, '_blank');
    }
  }, [blobUrl]);

  const toggleShowAllCode = useCallback(() => {
    setShowAllCode((prev) => !prev);
  }, []);

  useEffect(() => {
    if (htmlComplete) return;
    const complete = isHtmlComplete(code);
    setHtmlComplete(complete);
    handleTabChange(complete ? 'preview' : 'code');
  }, [code, handleTabChange, htmlComplete]);

  return (
    <div className="relative w-full overflow-hidden rounded-md">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between border-b border-gray-700 bg-[#282C34] px-3 py-1.5 text-white">
        <div className="flex">
          <button
            className={`mr-3 text-xs ${activeTab === 'code' ? 'font-semibold text-blue-400' : 'text-gray-400'}`}
            onClick={() => handleTabChange('code')}
          >
            {t('table:aiChat.codeBlock.code')}
          </button>
          <button
            className={`text-xs ${activeTab === 'preview' ? 'font-semibold text-blue-400' : 'text-gray-400'}`}
            onClick={() => handleTabChange('preview')}
          >
            {t('table:aiChat.codeBlock.preview')} {htmlComplete && '✓'}
          </button>
        </div>
        {isTruncated && !showAllCode && activeTab === 'code' && (
          <button
            onClick={toggleShowAllCode}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"
          >
            <ChevronDown size={14} />
            <span>{t('table:aiChat.codeBlock.hiddenLines', { count: hiddenLinesCount })}</span>
          </button>
        )}
        {isTruncated && showAllCode && activeTab === 'code' && (
          <button onClick={toggleShowAllCode} className="text-xs text-gray-400 hover:text-gray-200">
            {t('table:aiChat.codeBlock.collapseCode')}
          </button>
        )}
        {activeTab === 'preview' && (
          <button
            onClick={openInNewTab}
            className="flex items-center text-xs text-gray-400 hover:text-gray-200"
            title="Open in new tab"
          >
            <ExternalLink size={14} />
          </button>
        )}
      </div>

      <div className={activeTab === 'code' ? 'block' : 'hidden'}>
        <SyntaxHighlighter
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...(rest as any)}
          PreTag="div"
          language="html"
          style={oneDark}
          customStyle={{
            marginTop: 0,
            paddingTop: '2.5rem',
            borderRadius: '0.375rem',
          }}
        >
          {visibleCode}
        </SyntaxHighlighter>
      </div>

      <div className={activeTab === 'preview' ? 'block' : 'hidden'}>
        <div className="rounded-md pt-10">
          {iframeLoaded && (
            <iframe
              srcDoc={code}
              className="h-[400px] w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              title="HTML Preview"
              loading="lazy"
            />
          )}
        </div>
      </div>
    </div>
  );
};

const HtmlCodeBlock = memo(HtmlCodeBlockInner, (prevProps, nextProps) => {
  return prevProps.code === nextProps.code;
});

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children
);
