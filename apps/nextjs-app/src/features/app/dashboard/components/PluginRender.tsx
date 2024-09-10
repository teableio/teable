import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { connectToChild } from 'penpal';
import { useEffect, useRef } from 'react';

interface IPluginRenderProps extends React.IframeHTMLAttributes<HTMLIFrameElement> {
  src: string;
  onBridge: (bridge?: IChildBridgeMethods) => void;
}
export const PluginRender = (props: IPluginRenderProps) => {
  const { onBridge, ...rest } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!iframeRef.current) {
      return;
    }
    const connection = connectToChild<IChildBridgeMethods>({
      iframe: iframeRef.current,
      timeout: 10000,
    });

    connection.promise.then((child) => {
      onBridge(child);
    });

    connection.promise.catch((error) => {
      throw error;
    });

    return () => {
      connection.destroy();
      onBridge(undefined);
    };
  }, [onBridge]);

  // eslint-disable-next-line jsx-a11y/iframe-has-title
  return <iframe {...rest} ref={iframeRef} className="size-full rounded-b p-1" />;
};
