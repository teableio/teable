#!/usr/bin/env node
/**
 * Builds a comprehensive "kitchen sink" test base in Airtable via the official
 * meta API, to exercise the Airtable -> Teable importer. Reproducible: delete
 * the base and re-run anytime.
 *
 * Goal: hit as many field types AND option combinations as the API allows, so
 * every mapping branch the importer reads is covered — number precision,
 * currency symbol, rating icon/color/max, date format/time format/time zone,
 * duration format, select colors + special names, checkbox icon/color, and
 * (especially) the many LINK shapes: multi, single, self (multi + single),
 * several links between the same two tables, and a one-to-many whose MULTI
 * side is traversed first (the case that must still resolve to ManyOne).
 *
 * The API CANNOT create: computed fields (formula / rollup / lookup / count),
 * button, autoNumber, createdTime/By, externalSyncSource, or custom views.
 * Those are reported at the end for manual add.
 *
 * Usage:
 *   AIRTABLE_PAT=patXXX WORKSPACE=wspXXX node src/features/airtable-import/test-scripts/airtable-build-test-base.mjs
 *   (or BASE_ID=appXXX to add the tables to an existing base instead of creating one)
 *
 * PAT scopes: schema.bases:write, data.records:write, schema.bases:read, data.records:read.
 */
const PAT = process.env.AIRTABLE_PAT;
const WORKSPACE = process.env.WORKSPACE;
const BASE_NAME = 'Import Test — Kitchen Sink';
const API = 'https://api.airtable.com/v0';
if (!PAT || (!WORKSPACE && !process.env.BASE_ID)) {
  console.error('Set AIRTABLE_PAT and WORKSPACE (wsp…), or BASE_ID (app…) to reuse a base.');
  process.exit(1);
}

const req = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
};

const failedFields = [];
const fieldIds = {}; // name -> id (only successfully created)
const addField = async (baseId, tableId, field) => {
  try {
    const created = await req('POST', `/meta/bases/${baseId}/tables/${tableId}/fields`, field);
    fieldIds[field.name] = created.id;
    return created.id;
  } catch (e) {
    const reason = e.message.split('->')[1]?.trim() ?? e.message;
    console.warn(`  ⚠ "${field.name}" (${field.type}) skipped: ${reason}`);
    failedFields.push(`${field.name} (${field.type}): ${reason}`);
    return null;
  }
};

const main = async () => {
  // 1) Tables — three so links can be cross-table, self, and from a 3rd table.
  let baseId;
  let A; // All Fields
  let B; // Linked
  let C; // Self
  if (process.env.BASE_ID) {
    baseId = process.env.BASE_ID;
    const mk = async (name, primary) =>
      (
        await req('POST', `/meta/bases/${baseId}/tables`, {
          name,
          fields: [{ name: primary, type: 'singleLineText' }],
        })
      ).id;
    A = await mk('All Fields', 'Name');
    B = await mk('Linked', 'Name');
    C = await mk('Self', 'Title');
    console.log(`using existing base ${baseId} (added All Fields/Linked/Self)`);
  } else {
    const base = await req('POST', '/meta/bases', {
      workspaceId: WORKSPACE,
      name: BASE_NAME,
      tables: [
        { name: 'All Fields', fields: [{ name: 'Name', type: 'singleLineText' }] },
        { name: 'Linked', fields: [{ name: 'Name', type: 'singleLineText' }] },
        { name: 'Self', fields: [{ name: 'Title', type: 'singleLineText' }] },
      ],
    });
    baseId = base.id;
    const tid = (name) => base.tables.find((t) => t.name === name).id;
    A = tid('All Fields');
    B = tid('Linked');
    C = tid('Self');
    console.log(`base ${baseId} created (All Fields=${A}, Linked=${B}, Self=${C})`);
  }

  // 2) Linked table — targets for lookups / rollups / counts (added manually).
  await addField(baseId, B, { name: 'Amount', type: 'number', options: { precision: 2 } });
  await addField(baseId, B, {
    name: 'Category',
    type: 'singleSelect',
    options: { choices: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }] },
  });
  await addField(baseId, B, {
    name: 'When',
    type: 'date',
    options: { dateFormat: { name: 'iso' } },
  });
  await addField(baseId, B, { name: 'Files', type: 'multipleAttachments' });

  // 3) All Fields — one column per type, spread across option combinations.
  const basicFields = [
    // text family (email/url/phone get showAs on the Teable side)
    { name: 'Long text', type: 'multilineText' },
    { name: 'Rich text', type: 'richText' },
    { name: 'Email', type: 'email' },
    { name: 'URL', type: 'url' },
    { name: 'Phone', type: 'phoneNumber' },
    { name: 'Barcode', type: 'barcode' },
    // number precision / percent / currency symbols
    { name: 'Int', type: 'number', options: { precision: 0 } },
    { name: 'Decimal 1', type: 'number', options: { precision: 1 } },
    { name: 'Decimal 4', type: 'number', options: { precision: 4 } },
    { name: 'Percent 0', type: 'percent', options: { precision: 0 } },
    { name: 'Percent 2', type: 'percent', options: { precision: 2 } },
    { name: 'Currency USD', type: 'currency', options: { precision: 2, symbol: '$' } },
    { name: 'Currency EUR', type: 'currency', options: { precision: 0, symbol: '€' } },
    { name: 'Currency CNY', type: 'currency', options: { precision: 2, symbol: '¥' } },
    // duration formats
    { name: 'Dur h:mm', type: 'duration', options: { durationFormat: 'h:mm' } },
    { name: 'Dur h:mm:ss', type: 'duration', options: { durationFormat: 'h:mm:ss' } },
    { name: 'Dur millis', type: 'duration', options: { durationFormat: 'h:mm:ss.SSS' } },
    // rating icon / color / max
    {
      name: 'Rate star 5',
      type: 'rating',
      options: { max: 5, icon: 'star', color: 'yellowBright' },
    },
    {
      name: 'Rate heart 10',
      type: 'rating',
      options: { max: 10, icon: 'heart', color: 'redBright' },
    },
    { name: 'Rate flag 3', type: 'rating', options: { max: 3, icon: 'flag', color: 'blueBright' } },
    // date format variants
    { name: 'Date iso', type: 'date', options: { dateFormat: { name: 'iso' } } },
    { name: 'Date us', type: 'date', options: { dateFormat: { name: 'us' } } },
    { name: 'Date euro', type: 'date', options: { dateFormat: { name: 'european' } } },
    { name: 'Date friendly', type: 'date', options: { dateFormat: { name: 'friendly' } } },
    // dateTime: format × timeFormat × timeZone
    {
      name: 'DT utc 24',
      type: 'dateTime',
      options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' },
    },
    {
      name: 'DT client 12',
      type: 'dateTime',
      options: { dateFormat: { name: 'us' }, timeFormat: { name: '12hour' }, timeZone: 'client' },
    },
    {
      name: 'DT shanghai',
      type: 'dateTime',
      options: {
        dateFormat: { name: 'iso' },
        timeFormat: { name: '24hour' },
        timeZone: 'Asia/Shanghai',
      },
    },
    // select: many colors + special option names (emoji, comma)
    {
      name: 'Single select',
      type: 'singleSelect',
      options: {
        choices: [
          { name: 'Alpha', color: 'blueBright' },
          { name: 'Beta', color: 'greenBright' },
          { name: 'Gamma', color: 'redBright' },
          { name: 'Delta 🚀', color: 'purpleBright' },
          { name: 'Has, comma', color: 'orangeBright' },
        ],
      },
    },
    {
      name: 'Multi select',
      type: 'multipleSelects',
      options: {
        choices: [
          { name: 'One', color: 'cyanBright' },
          { name: 'Two', color: 'tealBright' },
          { name: 'Three', color: 'pinkBright' },
          { name: 'Four', color: 'grayBright' },
        ],
      },
    },
    // checkbox icon / color
    { name: 'Check green', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    { name: 'Check heart', type: 'checkbox', options: { icon: 'heart', color: 'redBright' } },
    // collaborators + attachments
    { name: 'Single collaborator', type: 'singleCollaborator' },
    { name: 'Multi collaborator', type: 'multipleCollaborators' },
    { name: 'Attachments', type: 'multipleAttachments' },
    // system / auto — API rejects these; reported for manual add
    { name: 'Created time', type: 'createdTime' },
    { name: 'Auto number', type: 'autoNumber' },
  ];
  for (const f of basicFields) await addField(baseId, A, f);

  // 4) LINKS — the many shapes (this is where the cardinality bugs live).
  //    Each two-way link auto-creates a symmetric field on the other table.
  // NOTE: the API cannot set prefersSingleRecordLink at create time, so every
  // link below is created as MULTI. Toggle the single-link ones in the UI
  // afterwards (see the manual list) to get the single + one-to-many shapes.
  const links = [
    // A -> B, two links between the SAME two tables (symmetric-collision test)
    { t: A, name: 'Link to B', opt: { linkedTableId: B } },
    { t: A, name: 'Link to B 2', opt: { linkedTableId: B } },
    // self link on A
    { t: A, name: 'Self link', opt: { linkedTableId: A } },
    // a link created from B -> A (gives A an auto symmetric). Toggle THIS to
    // single-link in the UI: A (table[0]) is then the multi side seen first —
    // the one-to-many that must still resolve to ManyOne.
    { t: B, name: 'Link to A', opt: { linkedTableId: A } },
    // link from a third table
    { t: C, name: 'C to A', opt: { linkedTableId: A } },
  ];
  for (const l of links)
    await addField(baseId, l.t, { name: l.name, type: 'multipleRecordLinks', options: l.opt });

  // 5) Records. B first (for ids), then A referencing them, then back/self links.
  const createRecords = async (tableId, records) => {
    const filtered = records.map((r) => ({
      fields: Object.fromEntries(
        Object.entries(r.fields).filter(
          ([k]) => k === 'Name' || k === 'Title' || fieldIds[k] != null
        )
      ),
    }));
    const out = [];
    for (let i = 0; i < filtered.length; i += 10) {
      const res = await req('POST', `/${baseId}/${tableId}`, {
        records: filtered.slice(i, i + 10),
        typecast: true,
      });
      out.push(...res.records);
    }
    return out;
  };
  const patchRecords = async (tableId, records) => {
    for (let i = 0; i < records.length; i += 10)
      await req('PATCH', `/${baseId}/${tableId}`, {
        records: records.slice(i, i + 10),
        typecast: true,
      });
  };

  const linkedRecs = await createRecords(
    B,
    Array.from({ length: 8 }, (_, i) => ({
      fields: { Name: `Linked ${i + 1}`, Amount: (i + 1) * 10, Category: ['X', 'Y', 'Z'][i % 3] },
    }))
  );
  const linkIds = linkedRecs.map((r) => r.id);

  const img =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png';
  const selectNames = ['Alpha', 'Beta', 'Gamma', 'Delta 🚀', 'Has, comma'];
  const allRecords = Array.from({ length: 20 }, (_, i) => {
    if (i === 0) return { fields: {} }; // an all-empty row
    return {
      fields: {
        Name: `Row ${i}${i % 5 === 0 ? ' 🚀 unicode ' + 'x'.repeat(80) : ''}${i === 7 ? ' nul byte' : ''}`,
        'Long text': `Notes ${i}\nsecond line${i === 7 ? ' ' : ''}`,
        Email: `user${i}@example.com`,
        URL: 'https://example.com/p?q=1',
        Phone: '+1 555 0100',
        Barcode: { text: `01234${i}` },
        Int: i % 2 === 0 ? i : -i, // include negatives + zero
        'Decimal 1': i + 0.25,
        'Decimal 4': i + 0.0001,
        'Percent 0': (i % 100) / 100,
        'Percent 2': (i * 3) / 100,
        'Currency USD': i * 9.99,
        'Currency EUR': i * 100,
        'Dur h:mm': i * 3661, // seconds
        'Rate star 5': (i % 5) + 1, // 1..5 (rating rejects 0)
        'Rate heart 10': (i % 10) + 1, // 1..10
        'Single select': selectNames[i % selectNames.length],
        'Multi select': [['One'], ['One', 'Two'], ['Two', 'Three', 'Four']][i % 3],
        'Check green': i % 2 === 0, // false rows test boolean omission
        'Date iso': `2026-0${(i % 9) + 1}-15`,
        'DT utc 24': `2026-03-15T0${i % 9}:30:00.000Z`,
        Attachments:
          i % 6 === 0 ? [{ url: img }, { url: img }] : i % 3 === 0 ? [{ url: img }] : undefined,
        'Link to B': linkIds.slice(0, (i % 3) + 1),
        'Link to B 2': linkIds.slice(3, 5),
      },
    };
  });
  const aRecs = await createRecords(A, allRecords);
  const aIds = aRecs.map((r) => r.id);

  // self links (A->A) and the back link (B->A), now that A ids exist
  if (fieldIds['Self link'])
    await patchRecords(
      A,
      aIds.slice(1, 6).map((id, i) => ({
        id,
        fields: { 'Self link': aIds.slice(0, (i % 2) + 1) },
      }))
    );
  if (fieldIds['Link to A'])
    await patchRecords(
      B,
      linkIds.slice(0, 5).map((id, i) => ({ id, fields: { 'Link to A': [aIds[i % aIds.length]] } }))
    );

  await createRecords(
    C,
    Array.from({ length: 4 }, (_, i) => ({
      fields: { Title: `Self ${i + 1}`, 'C to A': [aIds[i % aIds.length]] },
    }))
  );

  console.log(
    `\n✓ built "${BASE_NAME}": ${aRecs.length} rows in All Fields, ${linkIds.length} in Linked, ${Object.keys(fieldIds).length} fields created.`
  );
  if (failedFields.length) {
    console.log(`\n⚠ ${failedFields.length} field(s) the API could not create — add in the UI:`);
    for (const f of failedFields) console.log(`   - ${f}`);
  }
  console.log('\nStill add manually in the Airtable UI (API cannot create these):');
  console.log(
    '  • Formulas: numeric, text concat, date (DATEADD/DATETIME_FORMAT), logical (IF), a deliberately invalid one, and one using "^" (incompatible)'
  );
  console.log(
    '  • Toggle single-link on "Link to B 2" and "Link to A" (API cannot set prefersSingleRecordLink) — needed for single links + the one-to-many ManyOne case'
  );
  console.log(
    '  • single->many-to-many relax test: toggle a link to single, then link several records to the SAME target so its single-side data holds multiple values'
  );
  console.log(
    '  • On "Link to B": Rollup SUM/MAX/AVERAGE/COUNTALL/ARRAYJOIN/ARRAYUNIQUE, Count, Lookup (number + text + date)'
  );
  console.log('  • aiText field (if testing AI mapping)');
  console.log('  • Rename one "Single select"/"Multi select" option to blank (empty name)');
  console.log(
    '  • Views: Kanban×2 (by select + by collaborator), Calendar, Gallery, Timeline, List, plus a Grid with filter+sort+group+hidden fields+row height'
  );
  console.log('  • In "Self": make the primary "Title" a formula');
  console.log('  • Turn on Share → Share to web to test view-config extraction');
  console.log(`\nBase id: ${baseId}`);
};

main().catch((e) => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});
