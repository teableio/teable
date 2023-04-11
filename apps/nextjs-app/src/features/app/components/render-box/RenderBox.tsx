import React, { useRef, useEffect, useState } from 'react';
import { esbuildRun } from '@/lib/bundler';
import { preCode, templateHtml } from './config';

export const RenderBox: React.FC<{ code: string }> = ({ code }) => {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [compiling, setCompiling] = useState<boolean>();
  useEffect(() => {
    const buildRun = async () => {
      if (!iframe.current?.contentWindow) {
        return;
      }
      setCompiling(true);
      iframe.current.srcdoc = templateHtml;
      const runCode: string | undefined = await esbuildRun([preCode, code].join('\n'));
      iframe.current.contentWindow.postMessage(runCode || '', '*');
      if (!ignore) {
        setCompiling(false);
      }
    };
    let ignore = false;
    buildRun();
    return () => {
      ignore = true;
    };
  }, [code]);

  return (
    <div className="w-full h-72">
      {compiling && <h3>compiling...</h3>}
      <div className="w-full h-full" style={{ opacity: compiling ? 0 : 1 }}>
        <iframe
          className="w-full h-full"
          title="preview"
          ref={iframe}
          sandbox="allow-scripts"
          srcDoc={templateHtml}
        />
      </div>
    </div>
  );
};
