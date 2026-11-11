import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkDependencies,
  collectDependencies,
  compareDependencies,
} from './nest-v1-dependencies.mjs';

const script = fileURLToPath(new URL('./nest-v1-dependencies.mjs', import.meta.url));
const ce = 'community/apps/nestjs-backend/src';
const ee = 'enterprise/backend-ee/src';
const service = `${ce}/features/record/record.service.ts`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nest-v1-baseline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    const path = resolve(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  for (const backend of [ce, ee]) {
    mkdirSync(join(root, backend), { recursive: true });
    write(
      `${backend}/../tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'bundler',
          experimentalDecorators: true,
          paths: { '@teable/backend/*': ['../../community/apps/nestjs-backend/src/*'] },
        },
      })
    );
  }
  write(service, 'export class RecordService { read() {} }');
  write(`${ce}/features/field/field.service.ts`, 'export class FieldService {}');
  write(`${ce}/features/auth/permission.service.ts`, 'export class PermissionService {}');
  return { root, write };
}

const edge = (
  source,
  kind = 'import',
  owner = '',
  target = service,
  symbol = 'RecordService',
  scope = 'external-consumer'
) => ({ scope, source, target, symbol, kind, owner });
const byKey = (edges) =>
  [...edges].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

test('resolves aliased imports through barrels and EE path mappings to actual declarations', (t) => {
  const f = fixture(t);
  f.write(
    `${ce}/bridge.ts`,
    "export { RecordService as Legacy } from './features/record/record.service';"
  );
  const consumer = `${ee}/features/comment/consumer.ts`;
  f.write(
    consumer,
    `
    import type { Legacy as Renamed } from '@teable/backend/bridge';
    export class Consumer { constructor(private readonly records: Renamed) {} }
  `
  );
  const actual = collectDependencies(f.root);
  assert.deepEqual(
    actual.filter((item) => item.source === consumer),
    [edge(consumer), edge(consumer, 'injection', 'Consumer')]
  );
  assert.ok(
    actual.some(
      (item) =>
        item.source === `${ce}/bridge.ts` && item.kind === 'export' && item.target === service
    )
  );
});

test('recognizes import-equals, dynamic import, require, export-all and TS import types', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/task/runtime.ts`;
  for (const source of [
    "import Legacy = require('../record/record.service');",
    "const legacy = require('../record/record.service');",
    "const legacy = import('../record/record.service');",
    "type Legacy = import('../record/record.service').RecordService;",
  ]) {
    f.write(consumer, source);
    assert.deepEqual(collectDependencies(f.root), [edge(consumer)], source);
  }
  f.write(consumer, "export * from '../record/record.service';");
  assert.deepEqual(collectDependencies(f.root), [edge(consumer, 'export')]);
});

test('records a default import without importing unrelated named exports', (t) => {
  const f = fixture(t);
  f.write(service, 'export default class RecordService {} export class OtherService {}');
  const consumer = `${ce}/features/task/default.ts`;
  f.write(consumer, "import Legacy from '../record/record.service';");
  assert.deepEqual(collectDependencies(f.root), [edge(consumer)]);
});

test('detects namespace, token/property injection and provider registration separately', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/v2/consumer.ts`;
  f.write(
    consumer,
    `
    import * as Legacy from '../record/record.service';
    declare function Inject(token: unknown): PropertyDecorator;
    export class Consumer {
      @Inject(Legacy.RecordService) records!: Legacy.RecordService;
      constructor(records: Legacy.RecordService) {}
    }
    export const config = { providers: [Legacy.RecordService] };
  `
  );
  assert.deepEqual(
    byKey(collectDependencies(f.root)),
    byKey([
      edge(consumer, 'import', '', service, 'RecordService', 'v2-host'),
      edge(consumer, 'injection', 'Consumer', service, 'RecordService', 'v2-host'),
      edge(consumer, 'property-injection', 'Consumer', service, 'RecordService', 'v2-host'),
      edge(consumer, 'provider', 'config:providers', service, 'RecordService', 'v2-host'),
    ])
  );
});

test('a factory inject list adds a provider edge even when its import is already baselined', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/task/factory.ts`;
  const imported = "import { RecordService } from '../record/record.service';";
  f.write(consumer, imported);
  const baseline = collectDependencies(f.root);
  f.write(
    consumer,
    `${imported}\nexport const factory = { provide: 'worker', inject: [RecordService], useFactory: (records) => records };`
  );
  assert.deepEqual(compareDependencies(collectDependencies(f.root), baseline), {
    added: [edge(consumer, 'provider', 'factory:inject')],
    removed: [],
  });
});

test('two Module decorators in the same file have distinct provider owners', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/task/modules.ts`;
  const first =
    "import { RecordService } from '../record/record.service'; @Module({ providers: [RecordService] }) export class First {}";
  f.write(consumer, first);
  const baseline = collectDependencies(f.root);
  f.write(consumer, `${first}\n@Module({ providers: [RecordService] }) export class Second {}`);
  assert.deepEqual(compareDependencies(collectDependencies(f.root), baseline), {
    added: [edge(consumer, 'provider', 'Second:providers')],
    removed: [],
  });
});

test('CommonJS destructuring retains constructor injection identity', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/task/commonjs.ts`;
  const imported = "const { RecordService: Legacy } = require('../record/record.service');";
  f.write(consumer, imported);
  const baseline = collectDependencies(f.root);
  assert.deepEqual(baseline, [edge(consumer)]);
  f.write(
    consumer,
    `${imported}\nexport class Consumer { constructor(@Inject(Legacy) records) {} }`
  );
  assert.deepEqual(compareDependencies(collectDependencies(f.root), baseline), {
    added: [edge(consumer, 'injection', 'Consumer')],
    removed: [],
  });
});

test('an object-rest binding is not a named CommonJS export', (t) => {
  const f = fixture(t);
  f.write(
    `${ce}/features/task/rest.ts`,
    "const { OtherService: ignored, ...RecordService } = require('../record/record.service'); export class Consumer { constructor(@Inject(RecordService) token) {} }"
  );
  assert.deepEqual(collectDependencies(f.root), []);
});

test('a locally shadowed require never creates an engine dependency', (t) => {
  const f = fixture(t);
  f.write(
    `${ce}/features/task/shadow.ts`,
    "export function local(require: (name: string) => unknown) { require('../record/record.service'); }"
  );
  assert.deepEqual(collectDependencies(f.root), []);
});

test('shorthand metadata follows its initializer and retains the module owner', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/task/shorthand.ts`;
  const first =
    "import { RecordService } from '../record/record.service'; const inner = [RecordService]; const providers = inner;";
  f.write(consumer, first);
  const baseline = collectDependencies(f.root);
  f.write(consumer, `${first}\n@Module({ providers }) export class ConsumerModule {}`);
  assert.deepEqual(compareDependencies(collectDependencies(f.root), baseline), {
    added: [edge(consumer, 'provider', 'ConsumerModule:providers')],
    removed: [],
  });
});

test('CommonJS namespace injection resolves the accessed service, not the module container', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/task/namespace.ts`;
  const imported = "const Legacy = require('../record/record.service');";
  f.write(consumer, imported);
  const baseline = collectDependencies(f.root);
  f.write(
    consumer,
    `${imported}\nexport class Consumer { constructor(@Inject(Legacy.RecordService) records) {} }`
  );
  assert.deepEqual(compareDependencies(collectDependencies(f.root), baseline), {
    added: [edge(consumer, 'injection', 'Consumer')],
    removed: [],
  });
});

test('retains legacy identity through EE subclass wrappers without class-name guessing', (t) => {
  const f = fixture(t);
  const wrapper = `${ee}/features/community/record/record.service.ts`;
  f.write(
    wrapper,
    "import { RecordService as Base } from '@teable/backend/features/record/record.service'; export class EnterpriseRecords extends Base {}"
  );
  const consumer = `${ee}/features/task/consumer.ts`;
  f.write(
    consumer,
    "import { EnterpriseRecords as R } from '../community/record/record.service'; export class Consumer { constructor(records: R) {} }"
  );
  const expected = edge(consumer, 'injection', 'Consumer', wrapper, 'EnterpriseRecords');
  assert.ok(
    collectDependencies(f.root).some((item) => JSON.stringify(item) === JSON.stringify(expected))
  );
});

test('allows local same-named symbols, host services, v2 adapters and legacy internal wiring', (t) => {
  const f = fixture(t);
  f.write(`${ce}/features/table/table-index.service.ts`, 'export class TableIndexService {}');
  f.write(
    `${ce}/features/record/cross-base-link-access.service.ts`,
    'export class CrossBaseLinkAccessService {}'
  );
  f.write(`${ce}/features/record/record-v2.service.ts`, 'export class RecordV2Service {}');
  f.write(
    `${ce}/features/record/internal.ts`,
    "import { FieldService } from '../field/field.service'; export class Worker { constructor(field: FieldService) {} }"
  );
  f.write(
    `${ce}/features/v2/host.ts`,
    `
    import { TableIndexService } from '../table/table-index.service';
    import { CrossBaseLinkAccessService } from '../record/cross-base-link-access.service';
    import { PermissionService } from '../auth/permission.service';
    import { RecordV2Service } from '../record/record-v2.service';
    class RecordService {}
    export class Consumer { constructor(a: RecordService, b: PermissionService, c: TableIndexService, d: CrossBaseLinkAccessService, e: RecordV2Service) {} }
    const message = "import { RecordService } from '../record/record.service'";
  `
  );
  assert.deepEqual(collectDependencies(f.root), []);
});

test('tracks query-builder interface and custom injection decorator identities', (t) => {
  const f = fixture(t);
  const target = `${ce}/features/record/query-builder/index.ts`;
  f.write(
    target,
    'export interface IRecordQueryBuilder {} export const InjectRecordQueryBuilder = () => () => {};'
  );
  const consumer = `${ce}/features/database-view/consumer.ts`;
  f.write(
    consumer,
    "import { IRecordQueryBuilder as Q, InjectRecordQueryBuilder as InjectQ } from '../record/query-builder'; export class Consumer { constructor(@InjectQ() query: Q) {} }"
  );
  assert.deepEqual(
    byKey(collectDependencies(f.root)),
    byKey([
      edge(consumer, 'import', '', target, 'IRecordQueryBuilder'),
      edge(consumer, 'import', '', target, 'InjectRecordQueryBuilder'),
      edge(consumer, 'injection', 'Consumer', target, 'IRecordQueryBuilder'),
      edge(consumer, 'injection', 'Consumer', target, 'InjectRecordQueryBuilder'),
    ])
  );
});

test('the CLI rejects added edges and stale entries, then accepts a shrinking baseline', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/task/consumer.ts`;
  f.write(consumer, "import { RecordService } from '../record/record.service';");
  const baseline = collectDependencies(f.root);
  const save = (edges) =>
    f.write(
      'community/apps/nestjs-backend/scripts/nest-v1-dependencies.baseline.json',
      JSON.stringify(edges)
    );
  const cli = () => spawnSync(process.execPath, [script, '--root', f.root], { encoding: 'utf8' });
  save(baseline);
  assert.equal(cli().status, 0);

  f.write(
    consumer,
    "import { RecordService } from '../record/record.service'; export class Consumer { constructor(records: RecordService) {} }"
  );
  let result = cli();
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /NEW v1 dependency:.*consumer.ts.*RecordService \(injection:Consumer\)/
  );

  f.write(consumer, 'export class Consumer {}');
  result = cli();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STALE baseline.*consumer.ts.*RecordService/);
  save([]);
  assert.equal(cli().status, 0);
});

test('formatting and local import aliases do not churn stable baseline identities', (t) => {
  const f = fixture(t);
  const consumer = `${ce}/features/task/consumer.ts`;
  f.write(
    consumer,
    "import { RecordService as Old } from '../record/record.service'; export class Consumer { constructor(records: Old) {} }"
  );
  const baseline = collectDependencies(f.root);
  f.write(
    consumer,
    "\n// header\nimport { RecordService as New } from '../record/record.service';\n\nexport class Consumer {\n constructor(other: New) {}\n}\n"
  );
  assert.deepEqual(compareDependencies(collectDependencies(f.root), baseline), {
    added: [],
    removed: [],
  });
});

test('fails closed on missing roots, invalid TypeScript, malformed or duplicate baselines', (t) => {
  const f = fixture(t);
  const item = edge(`${ce}/features/task/consumer.ts`);
  assert.throws(() => compareDependencies([], {}), /must be an array/);
  assert.throws(() => compareDependencies([], [{ source: 'missing fields' }]), /Invalid/);
  assert.throws(() => compareDependencies([], [item, item]), /Duplicate/);
  f.write(`${ce}/features/v2/broken.ts`, 'export class {');
  assert.throws(() => collectDependencies(f.root), /expected|Unexpected/);
  rmSync(join(f.root, ee), { recursive: true });
  assert.throws(() => collectDependencies(f.root), /ENOENT/);
});

test('real Nest source dependencies exactly match the reviewed baseline', () => {
  const root = resolve(dirname(script), '../../../..');
  checkDependencies(root);
});
