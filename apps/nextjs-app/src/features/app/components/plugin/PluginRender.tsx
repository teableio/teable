import { pluginGetAuthCode, updateDashboardPluginStorage } from '@teable/openapi';
import type { IChildBridgeMethods, IParentBridgeMethods } from '@teable/sdk/plugin-bridge';
import { cn } from '@teable/ui-lib';
import type { Methods } from 'penpal';
import { connectToChild } from 'penpal';
import { useEffect, useRef } from 'react';

interface IPluginRenderProps extends React.IframeHTMLAttributes<HTMLIFrameElement> {
  src: string;
  pluginInstallId: string;
  positionId: string;
  pluginId: string;
  baseId: string;
  onBridge: (bridge?: IChildBridgeMethods) => void;
  onExpand?: () => void;
}
export const PluginRender = (props: IPluginRenderProps) => {
  const { onBridge, onExpand, pluginInstallId, baseId, positionId, pluginId, className, ...rest } =
    props;
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
        return updateDashboardPluginStorage(baseId, positionId, pluginInstallId, storage).then(
          (res) => res.data.storage ?? {}
        );
      },
      getAuthCode: () => {
        return pluginGetAuthCode(pluginId, baseId).then((res) => res.data);
      },
      expandPlugin: () => {
        onExpand?.();
      },
    };
    const connection = connectToChild<IChildBridgeMethods>({
      iframe: iframeRef.current,
      timeout: 20000,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line jsx-a11y/iframe-has-title
  return (
    <iframe
      loading={'lazy'}
      {...rest}
      ref={iframeRef}
      className={cn('rounded-b', className)}
      title={pluginInstallId}
    />
  );
};
