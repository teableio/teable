import type {
  IChildBridgeMethods,
  IParentBridgeMethods,
  IParentBridgeUIMethods,
  IParentBridgeUtilsMethods,
} from '@teable/sdk/plugin-bridge';
import { cn } from '@teable/ui-lib';
import type { Methods } from 'penpal';
import { connectToChild } from 'penpal';
import { useEffect, useRef } from 'react';
import { getPluginFrameOrigin } from './plugin-frame-origin';

interface IIframePluginRenderProps extends React.IframeHTMLAttributes<HTMLIFrameElement> {
  src: string;
  utilsEvent: IParentBridgeUtilsMethods;
  uiEvent: IParentBridgeUIMethods;
  bridge?: IChildBridgeMethods;
  onBridge: (bridge?: IChildBridgeMethods) => void;
}
export const IframePluginRender = (props: IIframePluginRenderProps) => {
  const { onBridge, utilsEvent, uiEvent, className, bridge, ...rest } = props;

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameOrigin =
    typeof window === 'undefined'
      ? undefined
      : getPluginFrameOrigin(rest.src, window.location.href);
  useEffect(() => {
    // No bridge for a frame that is not an http(s) page
    if (!iframeRef.current || !frameOrigin) {
      return;
    }
    // A frame this app serves itself already runs with the viewer's session, so the
    // viewer's own token gives it nothing new. Any other origin belongs to whoever
    // registered the plugin and acts through the plugin's auth code alone.
    const isOwnOrigin = frameOrigin === window.location.origin;
    const methods: IParentBridgeMethods = {
      expandRecord: (recordIds: string[]) => {
        return uiEvent.expandRecord(recordIds);
      },
      expandPlugin: () => {
        return uiEvent.expandPlugin();
      },
      getAuthCode: () => {
        return utilsEvent.getAuthCode();
      },
      getSelfTempToken: () => {
        if (!isOwnOrigin) {
          return Promise.reject(
            new Error('getSelfTempToken is not available to a plugin served from another origin')
          );
        }
        return utilsEvent.getSelfTempToken();
      },
      updateStorage: (storage) => {
        return utilsEvent.updateStorage(storage);
      },
      getSelectionRecords: (selection, options) => {
        return utilsEvent.getSelectionRecords(selection, options);
      },
    };
    const connection = connectToChild<IChildBridgeMethods>({
      iframe: iframeRef.current,
      // Pinned here instead of left to penpal's own reading of the src attribute
      childOrigin: frameOrigin,
      timeout: 20000,
      methods: methods as unknown as Methods,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBridge, frameOrigin]);

  // eslint-disable-next-line jsx-a11y/iframe-has-title
  return (
    // eslint-disable-next-line jsx-a11y/iframe-has-title
    <iframe loading={'lazy'} {...rest} ref={iframeRef} className={cn('rounded-b', className)} />
  );
};
