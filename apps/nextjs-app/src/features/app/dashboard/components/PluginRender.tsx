import { updateDashboardPluginStorage } from '@teable/openapi';
import type { IChildBridgeMethods, IParentBridgeMethods } from '@teable/sdk/plugin-bridge';
import type { Methods } from 'penpal';
import { connectToChild } from 'penpal';
import { useEffect, useRef } from 'react';

interface IPluginRenderProps extends React.IframeHTMLAttributes<HTMLIFrameElement> {
  src: string;
  pluginInstallId: string;
  dashboardId: string;
  baseId: string;
  onBridge: (bridge?: IChildBridgeMethods) => void;
}
export const PluginRender = (props: IPluginRenderProps) => {
  const { onBridge, pluginInstallId, baseId, dashboardId, ...rest } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!iframeRef.current) {
      return;
    }
    const methods: IParentBridgeMethods = {
      expandRecord: (recordIds) => {
        console.log('expandRecord', recordIds);
      },
      updateStorage: (storage) => {
        return updateDashboardPluginStorage(baseId, dashboardId, pluginInstallId, storage).then(
          (res) => res.data.storage ?? {}
        );
      },
    };
    const connection = connectToChild<IChildBridgeMethods>({
      iframe: iframeRef.current,
      timeout: 50000,
      methods: methods as unknown as Methods,
    });

    connection.promise.then((child) => {
      onBridge(child);
    });

    connection.promise.catch((error) => {
      throw error;
    });

    connection;

    return () => {
      connection.destroy();
      onBridge(undefined);
    };
  }, [onBridge, pluginInstallId, baseId, dashboardId]);

  // eslint-disable-next-line jsx-a11y/iframe-has-title
  return <iframe {...rest} ref={iframeRef} className="size-full rounded-b p-1" />;
};
