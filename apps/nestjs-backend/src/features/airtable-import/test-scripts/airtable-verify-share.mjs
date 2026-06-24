/**
 * End-to-end check of the view-config share path against the kitchen-sink test
 * base. Mirrors src/.../airtable-share.client.ts (resolveShare + fetchViewConfig)
 * in plain JS and prints the filters / sorts / groupLevels / metadata each view
 * exposes, to confirm a share link actually serves importable view config.
 *
 * Usage: node src/features/airtable-import/test-scripts/airtable-verify-share.mjs <shareLink> <viewId[,viewId...]>
 *        (or SHARE_LINK / VIEW_IDS env)
 */
const LINK = process.argv[2] ?? process.env.SHARE_LINK;
const VIEW_IDS = (process.argv[3] ?? process.env.VIEW_IDS ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
if (!LINK || !VIEW_IDS.length) {
  console.error(
    'Usage: airtable-verify-share.mjs <shareLink> <viewId[,viewId...]>  (or SHARE_LINK / VIEW_IDS env).'
  );
  process.exit(1);
}
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const main = async () => {
  const pageRes = await fetch(LINK, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'manual',
  });
  if (pageRes.status >= 300 && pageRes.status < 400) {
    throw new Error(`not public (redirect to ${pageRes.headers.get('location')})`);
  }
  const cookie = (pageRes.headers.getSetCookie?.() ?? []).map((e) => e.split(';')[0]).join('; ');
  const html = await pageRes.text();
  const requestId = html.match(/requestId: "(.*?)",/)?.[1];
  const initData = JSON.parse(html.match(/window\.initData = (.*?);\n/)?.[1] ?? '{}');
  const { sharedApplicationId: appId, accessPolicy, pageLoadId, codeVersion } = initData;
  console.log(`resolved: appId=${appId} codeVersion=${String(codeVersion).slice(0, 8)}…`);

  const headers = {
    'User-Agent': UA,
    Accept: 'application/json',
    'x-airtable-application-id': appId,
    'x-airtable-inter-service-client': 'webClient',
    'x-airtable-inter-service-client-code-version': codeVersion,
    'x-airtable-page-load-id': pageLoadId,
    'X-Requested-With': 'XMLHttpRequest',
    'x-time-zone': 'UTC',
    'x-user-locale': 'en',
    cookie,
  };
  for (const viewId of VIEW_IDS) {
    const params = new URLSearchParams({
      stringifiedObjectParams: JSON.stringify({
        mayOnlyIncludeRowAndCellDataForIncludedViews: true,
        mayExcludeCellDataForLargeViews: true,
        allowMsgpackOfResult: false,
      }),
      requestId,
      accessPolicy,
    });
    const res = await fetch(`https://airtable.com/v0.3/view/${viewId}/readData?${params}`, {
      headers,
    });
    const d = (await res.json()).data ?? {};
    console.log(`\n# ${viewId} — ${res.status}`);
    console.log('  filters:    ', JSON.stringify(d.filters));
    console.log('  sorts:      ', JSON.stringify(d.lastSortsApplied?.sortSet));
    console.log('  groupLevels:', JSON.stringify(d.groupLevels));
    console.log('  metadata:   ', d.metadata ? Object.keys(d.metadata).join(', ') : null);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('\n✓ share view-config read OK');
};

main().catch((e) => {
  console.error('FAIL:', e?.message ?? e);
  process.exit(1);
});
