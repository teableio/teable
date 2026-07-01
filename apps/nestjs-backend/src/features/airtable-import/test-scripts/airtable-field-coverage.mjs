#!/usr/bin/env node
/**
 * Scans every Airtable base the PAT can read and tallies field-type and link
 * relationship coverage — to confirm the real-base corpus already exercises the
 * computed / lookup / link combinations the meta API cannot create.
 *
 * Usage: AIRTABLE_PAT=patXXX node src/features/airtable-import/test-scripts/airtable-field-coverage.mjs
 */
const PAT = process.env.AIRTABLE_PAT;
const API = 'https://api.airtable.com/v0';
if (!PAT) {
  console.error('Set AIRTABLE_PAT (schema.bases:read).');
  process.exit(1);
}
const h = { Authorization: `Bearer ${PAT}` };
const get = async (p) => (await fetch(`${API}${p}`, { headers: h })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const { bases = [] } = await get('/meta/bases');
  const typeBases = new Map(); // fieldType -> Set(baseName)
  const typeCount = new Map(); // fieldType -> total field count
  const links = {
    single: new Set(),
    multi: 0,
    self: new Set(),
    oneWay: new Set(),
    sameTablePair: new Set(),
  };

  for (const base of bases) {
    let schema;
    try {
      schema = await get(`/meta/bases/${base.id}/tables`);
    } catch {
      continue;
    }
    await sleep(120);
    for (const table of schema.tables ?? []) {
      const linkTargets = new Map(); // linkedTableId -> count (for same-table-pair detection)
      for (const f of table.fields ?? []) {
        typeCount.set(f.type, (typeCount.get(f.type) ?? 0) + 1);
        if (!typeBases.has(f.type)) typeBases.set(f.type, new Set());
        typeBases.get(f.type).add(base.name);
        if (f.type === 'multipleRecordLinks') {
          const o = f.options ?? {};
          if (o.prefersSingleRecordLink) links.single.add(base.name);
          else links.multi++;
          if (o.linkedTableId === table.id) links.self.add(base.name);
          if (!o.inverseLinkFieldId) links.oneWay.add(base.name);
          linkTargets.set(o.linkedTableId, (linkTargets.get(o.linkedTableId) ?? 0) + 1);
        }
      }
      for (const n of linkTargets.values()) if (n > 1) links.sameTablePair.add(base.name);
    }
  }

  const tricky = [
    'multipleLookupValues',
    'rollup',
    'count',
    'formula',
    'createdTime',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
    'autoNumber',
    'button',
    'aiText',
    'multipleAttachments',
    'barcode',
    'multipleRecordLinks',
  ];
  console.log(
    `Scanned ${bases.length} bases.\n=== Field-type coverage (computed / hard-to-create) ===`
  );
  for (const t of tricky) {
    const b = typeBases.get(t);
    if (b)
      console.log(
        `  ${t.padEnd(22)} ${String(typeCount.get(t)).padStart(4)} fields  in ${b.size} bases`
      );
    else console.log(`  ${t.padEnd(22)}   — not present in any base`);
  }
  console.log('\n=== All field types seen ===');
  console.log('  ' + [...typeCount.keys()].sort().join(', '));
  console.log('\n=== Link relationship combinations ===');
  console.log(`  single-record links (prefersSingle): ${links.single.size} bases`);
  console.log(`  multi-record links:                  ${links.multi} fields`);
  console.log(`  self links (table -> itself):        ${links.self.size} bases`);
  console.log(`  one-way links (no inverse):          ${links.oneWay.size} bases`);
  console.log(`  multiple links between same 2 tables: ${links.sameTablePair.size} bases`);
};

main().catch((e) => console.error('FATAL:', e.message));
