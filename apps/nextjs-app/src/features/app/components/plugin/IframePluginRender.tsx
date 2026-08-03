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
  useEffect(() => {
    if (!iframeRef.current) {
      return;
    }
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
  }, [onBridge]);

  // eslint-disable-next-line jsx-a11y/iframe-has-title
  return (
    // eslint-disable-next-line jsx-a11y/iframe-has-title
    <iframe loading={'lazy'} {...rest} ref={iframeRef} className={cn('rounded-b', className)} />
  );
};
