import { useQuery } from '@tanstack/react-query';
import type { IGetPluginCenterListVo, IPluginI18n, PluginPosition } from '@teable/openapi';
import { getPluginCenterList } from '@teable/openapi';
import { Button, cn, Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { get } from 'lodash';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { PluginDetail } from './PluginDetail';

interface IPluginCenterProps {
  children?: React.ReactNode;
  positionType: PluginPosition;
  onInstall?: (pluginId: string, name: string, detail: IGetPluginCenterListVo[number]) => void;
}

export interface IPluginCenterDialogRef {
  open: () => void;
  close: () => void;
}

export const PluginCenterDialog = forwardRef<IPluginCenterDialogRef, IPluginCenterProps>(
  (props, ref) => {
    const { children, positionType, onInstall } = props;
    const [open, setOpen] = useState(false);
    const { i18n, t } = useTranslation(['common']);
    const language = i18n.language as unknown as keyof IPluginI18n;
    const [detailPlugin, setDetailPlugin] = useState<IGetPluginCenterListVo[number]>();

    const onClose = () => {
      setOpen(false);
      setDetailPlugin(undefined);
    };

    useImperativeHandle(
      ref,
      () =>
        ({
          open: () => setOpen(true),
          close: onClose,
        }) as IPluginCenterDialogRef
    );

    const { data: plugins } = useQuery({
      queryKey: ['plugin-center', positionType] as const,
      queryFn: ({ queryKey }) => getPluginCenterList([queryKey[1]]).then((res) => res.data),
    });
    const isEmpty = plugins?.length === 0;
    return (
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
            return;
          }
          setOpen(open);
        }}
      >
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent
          className="max-w-4xl"
          style={{ width: 'calc(100% - 40px)', height: 'calc(100% - 100px)' }}
        >
          <div
            className={cn(
              'md:h-fit mt-4 w-full space-y-3 md:grid md:grid-cols-2 md:gap-4 md:space-y-0',
              {
                'md:h-auto flex md:flex': isEmpty,
              }
            )}
          >
            {plugins?.map((plugin) => {
              const name = get(plugin.i18n, [language, 'name']) ?? plugin.name;
              const description = get(plugin.i18n, [language, 'description']) ?? plugin.description;
              const detailDesc = get(plugin.i18n, [language, 'detailDesc']) ?? plugin.detailDesc;
              return (
                <button
                  key={plugin.id}
                  className="flex h-20 w-full cursor-pointer items-center gap-3 rounded border p-2 hover:bg-accent"
                  onClick={() =>
                    setDetailPlugin({
                      ...plugin,
                      name,
                      description,
                      detailDesc,
                    })
                  }
                >
                  <Image
                    src={plugin.logo}
                    alt={name}
                    width={56}
                    height={56}
                    sizes="100%"
                    style={{
                      objectFit: 'contain',
                    }}
                  />
                  <div className="flex-auto text-left">
                    <div>{name}</div>
                    <div
                      className="line-clamp-2 break-words text-[13px] text-muted-foreground"
                      title={description}
                    >
                      {description}
                    </div>
                  </div>
                  <Button
                    size={'xs'}
                    variant={'outline'}
                    onClick={(e) => {
                      onInstall?.(plugin.id, name, plugin);
                      onClose();
                      e.stopPropagation();
                    }}
                  >
                    {t('common:pluginCenter.install')}
                  </Button>
                </button>
              );
            })}
            {isEmpty && (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                {t('common:pluginCenter.pluginEmpty.title')}
              </div>
            )}
          </div>
          {detailPlugin && (
            <PluginDetail
              plugin={detailPlugin}
              onBack={() => setDetailPlugin(undefined)}
              onInstall={() => {
                onInstall?.(detailPlugin.id, detailPlugin.name, detailPlugin);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    );
  }
);

PluginCenterDialog.displayName = 'PluginCenterDialog';
