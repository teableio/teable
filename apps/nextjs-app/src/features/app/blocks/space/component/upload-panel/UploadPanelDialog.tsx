import { importBaseStream, type INotifyVo } from '@teable/openapi';
import { Spin } from '@teable/ui-lib/index';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { spaceConfig } from '@/features/i18n/space.config';
import { ImportLogPanel, type ILogEntry } from './ImportLogPanel';
import { UploadPanel } from './UploadPanel';

const PHASE_I18N_MAP: Record<string, string> = {
  parsing_structure: 'space:import.phase.parsingStructure',
  creating_base: 'space:import.phase.creatingBase',
  creating_table: 'space:import.phase.creatingTable',
  creating_common_fields: 'space:import.phase.creatingCommonFields',
  creating_formula_fields: 'space:import.phase.creatingFormulaFields',
  creating_button_fields: 'space:import.phase.creatingButtonFields',
  creating_link_fields: 'space:import.phase.creatingLinkFields',
  creating_lookup_fields: 'space:import.phase.creatingLookupFields',
  creating_table_views: 'space:import.phase.creatingTableViews',
  creating_plugins: 'space:import.phase.creatingPlugins',
  creating_folders: 'space:import.phase.creatingFolders',
  creating_workflows: 'space:import.phase.creatingWorkflows',
  creating_apps: 'space:import.phase.creatingApps',
  creating_authority_matrix: 'space:import.phase.creatingAuthorityMatrix',
  queuing_attachments: 'space:import.phase.queuingAttachments',
  uploading_app_files: 'space:import.phase.uploadingAppFiles',
  queuing_data_import: 'space:import.phase.queuingDataImport',
};

interface IUploadPanelDialogProps {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UploadPanelDialog = (props: IUploadPanelDialogProps) => {
  const { open, onOpenChange, spaceId } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const [file, setFile] = React.useState<File | null>(null);
  const [notify, setNotify] = React.useState<INotifyVo | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [logs, setLogs] = React.useState<ILogEntry[]>([]);
  const createdBaseIdRef = React.useRef<string | null>(null);
  const createdBaseNameRef = React.useRef<string | null>(null);
  const openRef = React.useRef(open);
  openRef.current = open;

  const router = useRouter();

  // t() expects compile-time literal keys, but i18nKey is a runtime string from the map,
  // so we widen t to accept any string key once here instead of scattering `as any` at every call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tAny = t as (key: string, options?: Record<string, any>) => string;

  const translatePhase = React.useCallback(
    (phase: string, detail?: string) => {
      const i18nKey = PHASE_I18N_MAP[phase];
      if (!i18nKey) return phase;

      if (detail) {
        try {
          const parsed = JSON.parse(detail);
          if (parsed && typeof parsed === 'object' && 'table' in parsed) {
            return tAny(i18nKey, { table: parsed.table, fields: parsed.fields });
          }
        } catch {
          // not JSON, use as plain detail
        }
        return tAny(i18nKey, { detail });
      }
      return tAny(i18nKey);
    },
    [tAny]
  );

  const addLog = React.useCallback((message: string, type: ILogEntry['type'] = 'info') => {
    setLogs((prev) => [...prev, { message, type, timestamp: Date.now() }]);
  }, []);

  const showImportSuccessToast = React.useCallback(
    (baseId: string, baseName?: string) => {
      const label = baseName
        ? `🎉 ${baseName} ${tAny('space:import.phase.done')}`
        : `🎉 ${tAny('space:import.phase.done')}`;

      toast.info(
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <div
          className="cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => router.push(`/base/${baseId}`)}
        >
          {label}
          <span className="ml-1 text-blue-500 underline">
            {tAny('space:import.phase.clickToView')}
          </span>
        </div>,
        {
          position: 'top-center',
          duration: 1000 * 5,
          closeButton: true,
          style: { height: 70, display: 'flex', alignItems: 'center' },
        }
      );
    },
    [tAny, router]
  );

  const handleImport = React.useCallback(async () => {
    if (!notify) return;

    setIsImporting(true);
    createdBaseIdRef.current = null;
    createdBaseNameRef.current = null;
    setLogs([]);

    try {
      const result = await importBaseStream({ spaceId, notify }, (phase, detail) => {
        if (phase === 'creating_base') {
          createdBaseNameRef.current = detail ?? null;
        }
        if (phase === 'structure_created') {
          createdBaseIdRef.current = detail ?? null;
          return;
        }
        addLog(translatePhase(phase, detail));
      });

      const baseId = result.data.base.id;

      addLog(tAny('space:import.phase.done'), 'done');

      if (openRef.current) {
        // Dialog still open: auto navigate
        setFile(null);
        setNotify(null);
        setLogs([]);
        onOpenChange(false);
        router.push(`/base/${baseId}`);
      } else {
        // Dialog already closed: clean up state and show toast
        setFile(null);
        setNotify(null);
        setLogs([]);
        showImportSuccessToast(baseId, result.data.base.name);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      addLog(msg, 'error');

      if (createdBaseIdRef.current) {
        const navBaseId = createdBaseIdRef.current;
        const navBaseName = createdBaseNameRef.current;
        if (openRef.current) {
          setFile(null);
          setNotify(null);
          setLogs([]);
          onOpenChange(false);
          router.push(`/base/${navBaseId}`);
        } else {
          setFile(null);
          setNotify(null);
          setLogs([]);
          showImportSuccessToast(navBaseId, navBaseName ?? undefined);
        }
      }
      // else: structure failed, stay on dialog for user to see error
    } finally {
      setIsImporting(false);
    }
  }, [notify, spaceId, addLog, translatePhase, tAny, onOpenChange, router, showImportSuccessToast]);

  const showLogs = logs.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open && !isImporting) {
          setFile(null);
          setNotify(null);
          setLogs([]);
        }
      }}
    >
      <DialogContent
        className="min-w-[700px]"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('space:spaceSetting.importBase')}</DialogTitle>
        </DialogHeader>
        <div className="relative w-full">
          <div className={cn({ 'pointer-events-none': showLogs })}>
            <UploadPanel
              file={file}
              onClose={() => {
                setFile(null);
                setNotify(null);
              }}
              onChange={(file) => {
                setFile(file);
              }}
              accept=".tea"
              onFinished={(notify) => {
                setNotify(notify);
              }}
            />
          </div>
          <ImportLogPanel logs={logs} isImporting={isImporting} />
        </div>
        <DialogFooter>
          {/* Before import: confirm button */}
          {!showLogs && notify && (
            <Button
              variant={'default'}
              size={'sm'}
              onClick={handleImport}
              className="flex items-center gap-2"
            >
              {t('space:import.confirm')}
            </Button>
          )}
          {/* During import: disabled button with spinner */}
          {isImporting && (
            <Button variant={'default'} size={'sm'} disabled className="flex items-center gap-2">
              {t('space:import.confirm')}
              <Spin className="size-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
