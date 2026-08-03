import { importBaseStream, type IImportBaseProgressEvent, type INotifyVo } from '@teable/openapi';
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
import { ImportLogPanel, type ILogEntry, type ITableImportProgress } from './ImportLogPanel';
import { UploadPanel } from './UploadPanel';

const PHASE_I18N_MAP: Record<string, string> = {
  importing_v2: 'space:import.phase.importingV2',
  parsing_structure: 'space:import.phase.parsingStructure',
  creating_base: 'space:import.phase.creatingBase',
  creating_table: 'space:import.phase.creatingTable',
  table_structure_started: 'space:import.phase.tableStructureStarted',
  table_structure_validating: 'space:import.phase.tableStructureValidating',
  table_structure_committing: 'space:import.phase.tableStructureCommitting',
  table_structure_done: 'space:import.phase.tableStructureDone',
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
  restoring_base_nodes: 'space:import.phase.restoringBaseNodes',
  queuing_attachments: 'space:import.phase.queuingAttachments',
  uploading_app_files: 'space:import.phase.uploadingAppFiles',
  queuing_data_import: 'space:import.phase.queuingDataImport',
  importing_table_data: 'space:import.phase.importingTableData',
  restoring_link_relations: 'space:import.phase.restoringLinkRelations',
  table_data_started: 'space:import.phase.tableDataStarted',
  table_data_progress: 'space:import.phase.tableDataProgress',
  table_data_done: 'space:import.phase.tableDataDone',
  link_fields_progress: 'space:import.phase.linkFieldsProgress',
  link_fields_done: 'space:import.phase.linkFieldsDone',
  table_data_empty: 'space:import.phase.tableDataEmpty',
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
  const [isV2Importing, setIsV2Importing] = React.useState(false);
  const [logs, setLogs] = React.useState<ILogEntry[]>([]);
  const [tableProgresses, setTableProgresses] = React.useState<
    Record<string, ITableImportProgress>
  >({});
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
    (phase: string, detail?: string, event?: IImportBaseProgressEvent) => {
      const i18nKey = PHASE_I18N_MAP[phase];
      if (!i18nKey) return phase;

      if (event?.tableName) {
        return tAny(i18nKey, {
          tableName: event.tableName,
          tableIndex: event.tableIndex,
          totalTables: event.totalTables,
          detail: event.detail ?? detail,
        });
      }

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

  const updateTableProgress = React.useCallback(
    (event: IImportBaseProgressEvent) => {
      const isLinkFieldsProgress = event.phase.startsWith('link_fields_');
      const tableKey = isLinkFieldsProgress ? '__link_fields__' : event.tableId ?? event.tableName;
      if (!tableKey) return;

      setTableProgresses((previous) => ({
        ...previous,
        [tableKey]: {
          tableId: tableKey,
          tableName: isLinkFieldsProgress
            ? tAny('space:import.phase.linkFieldsData')
            : event.tableName ?? tableKey,
          processedRows: event.processedRows ?? previous[tableKey]?.processedRows ?? 0,
          totalRows: event.totalRows ?? previous[tableKey]?.totalRows,
          batchProcessedRows:
            event.batchProcessedRows ?? previous[tableKey]?.batchProcessedRows ?? undefined,
          currentBatch: event.currentBatch ?? previous[tableKey]?.currentBatch,
          status:
            event.phase === 'table_data_done' || event.phase === 'link_fields_done'
              ? 'done'
              : 'running',
        },
      }));
    },
    [tAny]
  );

  const updateStructureProgress = React.useCallback(
    (event: IImportBaseProgressEvent) => {
      const tableKey = '__table_structure__';
      const totalRows = event.totalTables;
      const processedRows = event.tableIndex ?? 0;

      setTableProgresses((previous) => ({
        ...previous,
        [tableKey]: {
          tableId: tableKey,
          tableName: tAny('space:import.phase.tableStructureData'),
          processedRows: processedRows || previous[tableKey]?.processedRows || 0,
          totalRows: totalRows ?? previous[tableKey]?.totalRows,
          status: event.phase === 'table_structure_done' ? 'done' : 'running',
          unit: 'tables',
        },
      }));
    },
    [tAny]
  );

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
    setIsV2Importing(false);
    createdBaseIdRef.current = null;
    createdBaseNameRef.current = null;
    setLogs([]);
    setTableProgresses({});

    try {
      const result = await importBaseStream(
        { spaceId, notify },
        (phase, detail, event) => {
          if (phase === 'importing_v2') {
            setIsV2Importing(true);
            addLog(translatePhase(phase, detail));
            return;
          }
          if (
            (phase.startsWith('table_data_') || phase.startsWith('link_fields_')) &&
            (event?.tableId || event?.tableName)
          ) {
            setIsV2Importing(false);
            updateTableProgress(event);
            return;
          }
          if (phase.startsWith('table_structure_') && (event?.tableId || event?.tableName)) {
            setIsV2Importing(false);
            updateStructureProgress(event);
            return;
          }
          if (phase === 'creating_base') {
            createdBaseNameRef.current = detail ?? null;
          }
          if (phase === 'structure_created') {
            setIsV2Importing(false);
            createdBaseIdRef.current = detail ?? null;
            return;
          }
          setIsV2Importing(false);
          addLog(
            translatePhase(phase, detail, event),
            phase === 'table_structure_done' ? 'done' : 'info'
          );
        },
        setIsV2Importing
      );

      const baseId = result.data.base.id;

      addLog(tAny('space:import.phase.done'), 'done');

      if (openRef.current) {
        // Dialog still open: auto navigate
        setFile(null);
        setNotify(null);
        setLogs([]);
        setTableProgresses({});
        onOpenChange(false);
        router.push(`/base/${baseId}`);
        return;
      }

      // Dialog already closed: clean up state and show toast
      setFile(null);
      setNotify(null);
      setLogs([]);
      setTableProgresses({});
      showImportSuccessToast(baseId, result.data.base.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      addLog(msg, 'error');
    } finally {
      setIsImporting(false);
      setIsV2Importing(false);
    }
  }, [
    notify,
    spaceId,
    addLog,
    translatePhase,
    tAny,
    onOpenChange,
    router,
    showImportSuccessToast,
    updateTableProgress,
    updateStructureProgress,
  ]);

  const tableProgressList = React.useMemo(() => Object.values(tableProgresses), [tableProgresses]);
  const showLogs = logs.length > 0 || tableProgressList.length > 0;
  const showV2Loading = isImporting && isV2Importing && !showLogs;

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open && !isImporting) {
          setFile(null);
          setNotify(null);
          setLogs([]);
          setTableProgresses({});
          setIsV2Importing(false);
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
          <div className={cn({ 'pointer-events-none opacity-50': showLogs || showV2Loading })}>
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
          {showV2Loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/70 text-sm text-muted-foreground">
              <Spin className="size-6" />
              <span>{tAny('space:import.phase.importingV2')}</span>
            </div>
          )}
          <ImportLogPanel
            logs={logs}
            tableProgresses={tableProgressList}
            isImporting={isImporting}
          />
        </div>
        <DialogFooter>
          {/* Before import: confirm button */}
          {!isImporting && !showLogs && notify && (
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
