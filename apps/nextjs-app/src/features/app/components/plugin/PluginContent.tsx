import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { Spin } from '@teable/ui-lib/base';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { IframeHTMLAttributes } from 'react';
import { useState } from 'react';
import { ComponentPluginRender } from './ComponentPluginRender';
import { useIframeUrl } from './hooks/iframe-url/useIframeUrl';
import { useIframeSize } from './hooks/useIframeSize';
import { useSyncBasePermissions } from './hooks/useSyncBasePermissions';
import { useSyncSelection } from './hooks/useSyncSelection';
import { useSyncUIConfig } from './hooks/useSyncUIConfig';
import { useSyncUrlParams } from './hooks/useSyncUrlParams';
import { useUIConfig } from './hooks/useUIConfig';
import { useUIEvent } from './hooks/useUIEvent';
import { useUtilsEvent } from './hooks/useUtilsEvent';
import { IframePluginRender } from './IframePluginRender';
import { RenderType } from './types';
import type { IPluginParams } from './types';

type IPluginContentProps = {
  className?: string;
  renderClassName?: string;
  dragging?: boolean;
  onExpand?: () => void;
  iframeAttributes?: IframeHTMLAttributes<HTMLIFrameElement>;
} & IPluginParams;

export const PluginContent = (props: IPluginContentProps) => {
  const { className, renderClassName, pluginInstallId, dragging, onExpand, iframeAttributes } =
    props;
  const { t } = useTranslation(['common']);
  const [bridge, setBridge] = useState<IChildBridgeMethods>();
  const { iframeUrl, renderType } = useIframeUrl(props);
  const [ref, { width, height }] = useIframeSize(dragging);
  const utilsEvent = useUtilsEvent(props);
  const uiEvent = useUIEvent({
    onExpandPlugin: onExpand,
  });

  const uiConfig = useUIConfig(props);
  useSyncUIConfig(bridge, props);
  useSyncBasePermissions(bridge);
  useSyncSelection(bridge);
  useSyncUrlParams(bridge);
  if (!iframeUrl) {
    return (
      <div
        ref={ref}
        className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
      >
        {t('common:pluginCenter.pluginUrlEmpty')}
      </div>
    );
  }

  return (
    <div ref={ref} className={cn('relative size-full overflow-hidden', className)}>
      {renderType === RenderType.Iframe && (
        <>
          {!bridge && (
            <div className="flex size-full items-center justify-center">
              <Spin />
            </div>
          )}
          <IframePluginRender
            title={pluginInstallId}
            width={width}
            height={height}
            bridge={bridge}
            onBridge={setBridge}
            src={iframeUrl}
            className={renderClassName}
            utilsEvent={utilsEvent}
            uiEvent={uiEvent}
            {...iframeAttributes}
          />
        </>
      )}
      {renderType === RenderType.Component && (
        <ComponentPluginRender
          {...props}
          uiConfig={uiConfig}
          utilsEvent={utilsEvent}
          uiEvent={uiEvent}
        />
      )}
    </div>
  );
};
