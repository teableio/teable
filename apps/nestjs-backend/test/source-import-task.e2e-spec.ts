import type { INestApplication } from '@nestjs/common';
import type {
  IImportAirtableTaskRo,
  IImportAirtableTaskVo,
  IImportAirtableVo,
  IImportGoogleSheetTaskVo,
  IImportGoogleSheetVo,
} from '@teable/openapi';
import {
  IMPORT_AIRTABLE_TASK,
  IMPORT_GOOGLE_SHEET_TASK,
  createImportAirtableTask,
  createImportGoogleSheetTask,
  getImportAirtableTask,
  getImportGoogleSheetTask,
  getTableList,
  urlBuilder,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IAirtableImportProgressReporter } from '../src/features/airtable-import/airtable-import.service';
import { AirtableImportService } from '../src/features/airtable-import/airtable-import.service';
import {
  GoogleSheetImportPartialError,
  GoogleSheetImportService,
} from '../src/features/google-sheet-import/google-sheet-import.service';
import type { IClsStore } from '../src/types/cls';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getRecords, initApp, permanentDeleteBase } from './utils/init-app';

/**
 * The task routes of the source importers against the real app and cache. The
 * importers themselves are stubbed (they need Airtable / Google): what is under
 * test is everything around them — the import running on after the response,
 * polling, and the same import never starting twice.
 */
describe('Source import tasks (e2e)', () => {
  let app: INestApplication;
  const spaceId = globalThis.testConfig.spaceId;

  interface IStubbedImport<TResult> {
    calls: number;
    report: IAirtableImportProgressReporter;
    /** The importer's "this is the base I write into" callback. */
    setBaseId: (baseId: string) => void;
    /** The user the import saw once the HTTP response was long gone. */
    userAfterResponse?: string;
    finish: (result: TResult) => void;
    fail: (error: unknown) => void;
  }

  const airtableVo = (baseId: string): IImportAirtableVo => ({
    base: { id: baseId, name: 'Imported', spaceId },
    tableIdMap: { tblSource: 'tblTarget' },
    fieldIdMap: { fldSource: 'fldTarget' },
    issues: [],
  });

  /** Replaces an importer with one the test finishes by hand. */
  const stubImport = <TResult>(
    service: object,
    method: 'importBase' | 'importSpreadsheet'
  ): IStubbedImport<TResult> => {
    const stub = { calls: 0 } as IStubbedImport<TResult>;
    vi.spyOn(service as Record<string, (...args: never[]) => unknown>, method).mockImplementation(
      (async (_ro: unknown, report: IAirtableImportProgressReporter, ...rest: unknown[]) => {
        stub.calls++;
        stub.report = report;
        // importBase(ro, report, onBaseResolved)
        // importSpreadsheet(ro, report, isAborted, onBaseResolved)
        stub.setBaseId = rest.at(-1) as (baseId: string) => void;
        const outcome = await new Promise<{ result: TResult } | { error: unknown }>((resolve) => {
          stub.finish = (result) => resolve({ result });
          stub.fail = (error) => resolve({ error });
        });
        // Read inside the import's own async context, long after its request was answered.
        stub.userAfterResponse = app.get(ClsService<IClsStore>).get('user.id');
        if ('error' in outcome) throw outcome.error;
        return outcome.result;
      }) as never
    );
    return stub;
  };

  /** Every test imports a different Airtable base, so no test finds another's task. */
  let sequence = 0;
  const airtableRo = (overrides: Partial<IImportAirtableTaskRo> = {}): IImportAirtableTaskRo => ({
    accessToken: 'patNeverUsed',
    airtableBaseId: `appE2e${Date.now()}${sequence++}`,
    spaceId,
    baseName: 'Imported',
    ...overrides,
  });

  const untilAirtable = async (
    taskId: string,
    predicate: (task: IImportAirtableTaskVo) => boolean
  ) =>
    vi.waitFor(
      async () => {
        const { data } = await getImportAirtableTask(taskId);
        expect(predicate(data)).toBe(true);
        return data;
      },
      { timeout: 8000, interval: 200 }
    );

  const untilGoogleSheet = async (
    taskId: string,
    predicate: (task: IImportGoogleSheetTaskVo) => boolean
  ) =>
    vi.waitFor(
      async () => {
        const { data } = await getImportGoogleSheetTask(taskId);
        expect(predicate(data)).toBe(true);
        return data;
      },
      { timeout: 8000, interval: 200 }
    );

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterEach(() => {
    // The app is shared between spec files: never leave an importer stubbed.
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers at once and keeps importing after the response, as the same user', async () => {
    const stub = stubImport<IImportAirtableVo>(app.get(AirtableImportService), 'importBase');

    const { data: submitted, status } = await createImportAirtableTask(airtableRo());
    expect(status).toBe(201);
    expect(submitted).toEqual({ taskId: expect.any(String), status: 'running', reused: false });
    expect(stub.calls).toBe(1);

    expect((await getImportAirtableTask(submitted.taskId)).data).toMatchObject({
      taskId: submitted.taskId,
      status: 'running',
    });

    stub.setBaseId('bseE2eTarget');
    stub.report({ phase: 'creating_table', tableName: 'Orders' });
    const running = await untilAirtable(submitted.taskId, (task) => !!task.progress);
    expect(running).toMatchObject({
      status: 'running',
      baseId: 'bseE2eTarget',
      progress: { phase: 'creating_table', tableName: 'Orders' },
    });

    stub.finish(airtableVo('bseE2eTarget'));
    const done = await untilAirtable(submitted.taskId, (task) => task.status === 'completed');
    expect(done.result).toEqual(airtableVo('bseE2eTarget'));
    expect(stub.userAfterResponse).toBe(globalThis.testConfig.userId);
  });

  it('returns the running import instead of starting the same one again', async () => {
    const stub = stubImport<IImportAirtableVo>(app.get(AirtableImportService), 'importBase');
    const ro = airtableRo();

    const { data: first } = await createImportAirtableTask(ro);
    const { data: retry } = await createImportAirtableTask({ ...ro, importAttachments: false });
    const { data: forced } = await createImportAirtableTask({ ...ro, force: true });

    // The retry asked for other options; it is told they are not what is running.
    expect(retry).toEqual({
      taskId: first.taskId,
      status: 'running',
      reused: true,
      sameOptions: false,
    });
    // `force` is not an import option: this is the very request that is running.
    expect(forced).toEqual({
      taskId: first.taskId,
      status: 'running',
      reused: true,
      sameOptions: true,
    });
    expect(stub.calls).toBe(1);

    stub.finish(airtableVo('bseE2eOnce'));
    await untilAirtable(first.taskId, (task) => task.status === 'completed');
  });

  it('starts a second import of the same source when it goes somewhere else', async () => {
    const stub = stubImport<IImportAirtableVo>(app.get(AirtableImportService), 'importBase');
    const ro = airtableRo({ baseName: 'Copy A' });

    const { data: first } = await createImportAirtableTask(ro);
    const finishFirst = stub.finish;
    // The same Airtable base into the same space, as a differently named project.
    const { data: second } = await createImportAirtableTask({ ...ro, baseName: 'Copy B' });

    expect(second).toMatchObject({ status: 'running', reused: false });
    expect(second.taskId).not.toBe(first.taskId);
    expect(stub.calls).toBe(2);

    finishFirst(airtableVo('bseE2eCopyA'));
    stub.finish(airtableVo('bseE2eCopyB'));
    await untilAirtable(first.taskId, (task) => task.status === 'completed');
    await untilAirtable(second.taskId, (task) => task.status === 'completed');
  });

  it('answers a repeat of a finished import with its result, unless forced', async () => {
    const stub = stubImport<IImportAirtableVo>(app.get(AirtableImportService), 'importBase');
    const ro = airtableRo();

    const { data: first } = await createImportAirtableTask(ro);
    stub.finish(airtableVo('bseE2eFinished'));
    await untilAirtable(first.taskId, (task) => task.status === 'completed');

    const { data: repeat } = await createImportAirtableTask(ro);
    expect(repeat).toEqual({
      taskId: first.taskId,
      status: 'completed',
      reused: true,
      sameOptions: true,
    });
    expect(stub.calls).toBe(1);

    const { data: forced } = await createImportAirtableTask({ ...ro, force: true });
    expect(forced).toMatchObject({ status: 'running', reused: false });
    expect(forced.taskId).not.toBe(first.taskId);
    expect(stub.calls).toBe(2);

    stub.finish(airtableVo('bseE2eForced'));
    await untilAirtable(forced.taskId, (task) => task.status === 'completed');
  });

  it('reports a failed import and lets it be started again', async () => {
    const stub = stubImport<IImportAirtableVo>(app.get(AirtableImportService), 'importBase');
    const ro = airtableRo();

    const { data: first } = await createImportAirtableTask(ro);
    // The base exists, but the import dies before it reports any progress.
    stub.setBaseId('bseE2eHalf');
    stub.fail(new Error('Airtable went away'));
    const failed = await untilAirtable(first.taskId, (task) => task.status === 'failed');
    expect(failed).toMatchObject({
      baseId: 'bseE2eHalf',
      error: { message: 'Airtable went away' },
    });
    expect(failed.result).toBeUndefined();

    const { data: again } = await createImportAirtableTask(ro);
    expect(again).toMatchObject({ status: 'running', reused: false });
    expect(stub.calls).toBe(2);

    stub.finish(airtableVo('bseE2eAgain'));
    await untilAirtable(again.taskId, (task) => task.status === 'completed');
  });

  it('checks the target before anything is started', async () => {
    const stub = stubImport<IImportAirtableVo>(app.get(AirtableImportService), 'importBase');

    await expect(
      createImportAirtableTask(airtableRo({ spaceId: undefined, baseId: 'bseNotMine00000000' }))
    ).rejects.toMatchObject({ status: expect.toSatisfy((code: number) => code >= 400) });
    await expect(
      createImportAirtableTask(airtableRo({ baseName: undefined }))
    ).rejects.toMatchObject({ status: 400 });
    expect(stub.calls).toBe(0);
  });

  it('shows a task only to the user who started it, on its own route', async () => {
    const stub = stubImport<IImportAirtableVo>(app.get(AirtableImportService), 'importBase');
    const { data: task } = await createImportAirtableTask(airtableRo());

    const stranger = await createNewUserAxios({
      email: `import-task-stranger-${Date.now()}@example.com`,
      password: '12345678',
    });
    await expect(
      stranger.get(urlBuilder(IMPORT_AIRTABLE_TASK, { taskId: task.taskId }))
    ).rejects.toMatchObject({ status: 404 });
    await expect(getImportGoogleSheetTask(task.taskId)).rejects.toMatchObject({ status: 404 });
    await expect(getImportAirtableTask('imt0000000000000000')).rejects.toMatchObject({
      status: 404,
    });
    expect(urlBuilder(IMPORT_GOOGLE_SHEET_TASK, { taskId: 'x' })).toContain('/tasks/x');

    stub.finish(airtableVo('bseE2ePrivate'));
    await untilAirtable(task.taskId, (state) => state.status === 'completed');
  });

  it('runs a Google Sheets import as a task and keeps what a partial failure imported', async () => {
    const stub = stubImport<IImportGoogleSheetVo>(
      app.get(GoogleSheetImportService),
      'importSpreadsheet'
    );
    const ro = {
      accessToken: 'tokenNeverUsed',
      spreadsheetId: `sheetE2e${Date.now()}`,
      spaceId,
      baseName: 'Imported sheet',
    };

    const { data: first } = await createImportGoogleSheetTask({ ...ro, sheetIds: [0] });
    const finishFirst = stub.finish;
    // Other tabs of the same spreadsheet are a different import.
    const { data: otherTabs } = await createImportGoogleSheetTask({ ...ro, sheetIds: [7] });
    expect(otherTabs.reused).toBe(false);
    expect(stub.calls).toBe(2);

    const partial = {
      base: { id: 'bseE2eKept', name: 'Imported sheet', spaceId },
      tableIdMap: { gid0: 'tblKept' },
      issues: [],
    };
    stub.setBaseId('bseE2eKept');
    stub.fail(new GoogleSheetImportPartialError(new Error('quota exceeded'), partial));

    const failed = await untilGoogleSheet(otherTabs.taskId, (task) => task.status === 'failed');
    expect(failed).toMatchObject({
      baseId: 'bseE2eKept',
      error: { message: 'quota exceeded', partial },
    });
    // The first import is untouched by the second one's failure.
    expect((await getImportGoogleSheetTask(first.taskId)).data.status).toBe('running');

    finishFirst({ ...partial, base: { ...partial.base, id: 'bseE2eFirst' } });
    await untilGoogleSheet(first.taskId, (task) => task.status === 'completed');
  });
});

/**
 * The real importer behind the task route: a public spreadsheet imported end to
 * end, with every write happening after the request that started it was answered.
 *
 * Gated on env, so CI without them skips it:
 *   GOOGLE_SHEET_PUBLIC_API_KEY=…        server key for "anyone with the link" sheets
 *   GOOGLE_SHEET_TEST_SPREADSHEET=…      id of a small public spreadsheet with data
 */
const publicSpreadsheet = process.env.GOOGLE_SHEET_TEST_SPREADSHEET;

describe.skipIf(!process.env.GOOGLE_SHEET_PUBLIC_API_KEY || !publicSpreadsheet)(
  'Source import task, real Google Sheets import (e2e, needs GOOGLE_SHEET_PUBLIC_API_KEY + GOOGLE_SHEET_TEST_SPREADSHEET)',
  () => {
    let app: INestApplication;
    let importedBaseId: string | undefined;

    beforeAll(async () => {
      app = (await initApp()).app;
    });

    afterAll(async () => {
      if (importedBaseId) await permanentDeleteBase(importedBaseId).catch(() => undefined);
      await app.close();
    });

    it('imports the spreadsheet in the background and reports the finished import', async () => {
      const { data: submitted } = await createImportGoogleSheetTask({
        spreadsheetId: publicSpreadsheet as string,
        spaceId: globalThis.testConfig.spaceId,
        baseName: 'E2E Google Sheets task import',
      });
      expect(submitted).toMatchObject({ status: 'running', reused: false });

      const task = await vi.waitFor(
        async () => {
          const { data } = await getImportGoogleSheetTask(submitted.taskId);
          importedBaseId = data.baseId ?? importedBaseId;
          expect(data.status).not.toBe('running');
          return data;
        },
        { timeout: 170_000, interval: 1000 }
      );

      expect(task.error).toBeUndefined();
      expect(task.status).toBe('completed');
      expect(task.baseId).toBe(task.result?.base.id);
      importedBaseId = task.result?.base.id;

      const tableIds = Object.values(task.result?.tableIdMap ?? {});
      expect(tableIds.length).toBeGreaterThan(0);
      const { data: tables } = await getTableList(importedBaseId as string);
      expect(tables.map((table) => table.id)).toEqual(expect.arrayContaining(tableIds));
      expect((await getRecords(tableIds[0])).records.length).toBeGreaterThan(0);
    }, 180_000);
  }
);
