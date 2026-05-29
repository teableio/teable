import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const backendRoot = join(__dirname, '../..');

const tableScopedDataPlaneFiles = [
  'src/event-emitter/listeners/record-history.listener.ts',
  'src/features/aggregation/aggregation.service.ts',
  'src/features/base/base-query/base-query.service.ts',
  'src/features/base/base.service.ts',
  'src/features/base/base-export.service.ts',
  'src/features/base/db-connection.service.ts',
  'src/features/base-sql-executor/base-sql-executor.service.ts',
  'src/features/calculation/batch.service.ts',
  'src/features/calculation/field-calculation.service.ts',
  'src/features/calculation/link.service.ts',
  'src/features/calculation/system-field.service.ts',
  'src/features/database-view/database-view.service.ts',
  'src/features/field/field-calculate/field-converting.service.ts',
  'src/features/field/field-calculate/field-converting-link.service.ts',
  'src/features/field/field-calculate/field-supplement.service.ts',
  'src/features/field/field-duplicate/field-duplicate.service.ts',
  'src/features/field/field.service.ts',
  'src/features/field/open-api/field-open-api.service.ts',
  'src/features/graph/graph.service.ts',
  'src/features/integrity/foreign-key.service.ts',
  'src/features/integrity/link-field.service.ts',
  'src/features/integrity/link-integrity.service.ts',
  'src/features/integrity/unique-index.service.ts',
  'src/features/record/computed/services/computed-dependency-collector.service.ts',
  'src/features/record/computed/services/computed-orchestrator.service.ts',
  'src/features/record/computed/services/link-cascade-resolver.ts',
  'src/features/record/computed/services/record-computed-update.service.ts',
  'src/features/record/open-api/record-open-api.service.ts',
  'src/features/record/record-query.service.ts',
  'src/features/record/record.service.ts',
  'src/features/share/share.service.ts',
  'src/features/table/table-index.service.ts',
  'src/features/table/open-api/table-open-api.service.ts',
  'src/features/view/open-api/view-open-api.service.ts',
  'src/share-db/readonly/record-readonly.service.ts',
];

describe('BYODB data-plane routing guard', () => {
  it('keeps migrated table-scoped data-plane services off the default data Prisma client', () => {
    for (const file of tableScopedDataPlaneFiles) {
      const content = readFileSync(join(backendRoot, file), 'utf8');

      expect(content, file).not.toContain("from '@teable/db-data-prisma'");
      expect(content, file).not.toContain('private readonly dataPrismaService');
      expect(content, file).not.toContain('this.dataPrismaService');
    }
  });
});
