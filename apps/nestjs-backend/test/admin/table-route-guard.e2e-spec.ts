import type { INestApplication } from '@nestjs/common';
import { initApp } from '../utils/init-app';
import { auditTableRoutes, type ITableRouteAudit } from './table-route-audit';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe('Table route engine ledger (community e2e)', () => {
  let app: INestApplication;
  let audit: ITableRouteAudit;

  beforeAll(async () => {
    app = (await initApp()).app;
    audit = auditTableRoutes(app, 'CE');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('every scoped route has an engine decision', () => {
    expect(
      audit.missing,
      `new table routes without an engine decision; add them to test/admin/table-route-ledger.ts:\n${audit.missing.join('\n')}`
    ).toEqual([]);
  });

  it('the ledger names only routes the community app still registers', () => {
    expect(audit.stale, 'ledger entries for routes the community app no longer registers').toEqual(
      []
    );
  });

  it('the ledger only contains valid decisions', () => {
    expect(audit.invalid, 'ledger decisions must be v2, v2-only, host, or v1:<ticket>').toEqual([]);
  });
});
