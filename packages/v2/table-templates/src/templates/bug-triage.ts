/* eslint-disable sonarjs/no-duplicate-string */
import type { ICreateTableRequestDto } from '@teable/v2-contract-http';

import type { TemplateTableSeed, TemplateSeed } from '../types';
import {
  createFieldId,
  createRecordId,
  createSelectOption,
  createTableId,
  createTemplate,
} from '../utils';

const createBugTriageTemplateSeed = (): TemplateSeed => {
  const componentsTableId = createTableId();
  const componentNameFieldId = createFieldId();

  // Create more component records for variety
  const componentRecordIds = {
    auth: createRecordId(),
    ui: createRecordId(),
    export: createRecordId(),
    api: createRecordId(),
    database: createRecordId(),
    notifications: createRecordId(),
    search: createRecordId(),
    payments: createRecordId(),
    settings: createRecordId(),
    reports: createRecordId(),
    integrations: createRecordId(),
    performance: createRecordId(),
  };

  const componentNames = Object.keys(componentRecordIds) as (keyof typeof componentRecordIds)[];

  const componentsTable: TemplateTableSeed = {
    key: 'components',
    name: 'Components',
    description: 'Product areas your bugs belong to.',
    tableId: componentsTableId,
    fields: [{ type: 'singleLineText', id: componentNameFieldId, name: 'Name', isPrimary: true }],
    defaultRecordCount: 12,
    records: [
      { id: componentRecordIds.auth, fields: { [componentNameFieldId]: 'Auth' } },
      { id: componentRecordIds.ui, fields: { [componentNameFieldId]: 'UI' } },
      { id: componentRecordIds.export, fields: { [componentNameFieldId]: 'Export' } },
      { id: componentRecordIds.api, fields: { [componentNameFieldId]: 'API' } },
      { id: componentRecordIds.database, fields: { [componentNameFieldId]: 'Database' } },
      { id: componentRecordIds.notifications, fields: { [componentNameFieldId]: 'Notifications' } },
      { id: componentRecordIds.search, fields: { [componentNameFieldId]: 'Search' } },
      { id: componentRecordIds.payments, fields: { [componentNameFieldId]: 'Payments' } },
      { id: componentRecordIds.settings, fields: { [componentNameFieldId]: 'Settings' } },
      { id: componentRecordIds.reports, fields: { [componentNameFieldId]: 'Reports' } },
      { id: componentRecordIds.integrations, fields: { [componentNameFieldId]: 'Integrations' } },
      { id: componentRecordIds.performance, fields: { [componentNameFieldId]: 'Performance' } },
    ],
  };

  const bugsTableId = createTableId();
  const titleFieldId = createFieldId();
  const severityFieldId = createFieldId();
  const statusFieldId = createFieldId();
  const environmentFieldId = createFieldId();
  const stepsFieldId = createFieldId();
  const reproducibleFieldId = createFieldId();
  const reportedAtFieldId = createFieldId();
  const componentLinkFieldId = createFieldId();
  const componentLookupFieldId = createFieldId();
  const componentConditionalLookupFieldId = createFieldId();
  const componentConditionalRollupFieldId = createFieldId();

  const severityOptions = [
    createSelectOption('Low', 'green'),
    createSelectOption('Medium', 'yellow'),
    createSelectOption('High', 'orange'),
    createSelectOption('Critical', 'red'),
  ];
  const statusOptions = [
    createSelectOption('New', 'blue'),
    createSelectOption('Triaged', 'yellow'),
    createSelectOption('In Progress', 'purple'),
    createSelectOption('Fixed', 'green'),
    createSelectOption("Won't Fix", 'gray'),
  ];

  // Bug title templates for each component
  const bugTitlesByComponent: Record<keyof typeof componentRecordIds, string[]> = {
    auth: [
      'Login fails on retry',
      'Password reset email not sent',
      'Session expires prematurely',
      'OAuth callback error',
      '2FA code not accepted',
      'SSO redirect loop',
      'Remember me not working',
      'Logout not clearing session',
      'Invalid token on refresh',
      'Account lockout not triggering',
    ],
    ui: [
      'Tooltip overlaps content',
      'Modal close button unclickable',
      'Dropdown menu cut off on mobile',
      'Dark mode colors inconsistent',
      'Table columns not resizing',
      'Sidebar collapse animation glitch',
      'Loading spinner stuck',
      'Form validation messages hidden',
      'Button hover state missing',
      'Responsive layout broken at 768px',
    ],
    export: [
      'Export timeout on large datasets',
      'CSV encoding issues with unicode',
      'PDF export missing headers',
      'Excel export corrupts formulas',
      'Export progress bar stuck at 99%',
      'Scheduled exports failing silently',
      'Export file name truncated',
      'Date format wrong in exports',
      'Export includes deleted records',
      'Memory spike during export',
    ],
    api: [
      'Rate limiting too aggressive',
      'API returns 500 on valid request',
      'Pagination cursor breaks',
      'Webhook delivery failing',
      'API response time degraded',
      'CORS error on OPTIONS request',
      'API versioning not working',
      'Batch endpoint timeout',
      'GraphQL query depth limit',
      'API key rotation failing',
    ],
    database: [
      'Slow query on user table',
      'Deadlock during concurrent updates',
      'Index not being used',
      'Connection pool exhausted',
      'Migration rollback failed',
      'Data truncation on insert',
      'Foreign key constraint error',
      'Sequence gap in auto-increment',
      'Backup job failing',
      'Replication lag increasing',
    ],
    notifications: [
      'Email notifications delayed',
      'Push notifications not delivered',
      'Notification preferences ignored',
      'Duplicate notifications sent',
      'In-app badge count wrong',
      'Notification sound not playing',
      'Unsubscribe link broken',
      'Email template rendering issue',
      'Slack integration message format',
      'SMS notifications failing',
    ],
    search: [
      'Search results not relevant',
      'Fuzzy search too strict',
      'Search index out of sync',
      'Autocomplete suggestions wrong',
      'Search filters not applied',
      'Empty search returns error',
      'Special characters break search',
      'Search highlighting incorrect',
      'Faceted search counts wrong',
      'Search performance degraded',
    ],
    payments: [
      'Payment declined incorrectly',
      'Subscription not activating',
      'Invoice amount calculation wrong',
      'Refund not processing',
      'Payment method not saving',
      'Currency conversion error',
      'Promo code not applying',
      'Receipt email not sent',
      'Billing cycle date wrong',
      'Tax calculation incorrect',
    ],
    settings: [
      'Settings not persisting',
      'Timezone setting ignored',
      'Language preference resetting',
      'Notification settings not saving',
      'Privacy settings UI confusing',
      'API key regeneration fails',
      'Theme selection not applying',
      'Default view not remembered',
      'Account deletion incomplete',
      'Profile photo upload failing',
    ],
    reports: [
      'Report data stale',
      'Chart rendering incorrectly',
      'Report filters not working',
      'Scheduled report not sending',
      'Report date range wrong',
      'Custom report builder crash',
      'Report export timeout',
      'Dashboard widgets loading slow',
      'Metric calculations off',
      'Report permissions not enforced',
    ],
    integrations: [
      'Zapier trigger not firing',
      'Salesforce sync failing',
      'Google Calendar disconnect',
      'Slack bot not responding',
      'GitHub webhook missing events',
      'Jira sync duplicating issues',
      'Mailchimp list sync error',
      'Stripe webhook signature invalid',
      'HubSpot contact sync lag',
      'Zendesk ticket creation fails',
    ],
    performance: [
      'Page load time increased',
      'Memory leak in dashboard',
      'CPU spike during idle',
      'Database query timeout',
      'CDN cache not invalidating',
      'Bundle size too large',
      'API latency increased',
      'Websocket connection drops',
      'Image loading slow',
      'Background jobs queuing up',
    ],
  };

  const environments = ['Production', 'Staging', 'Development', 'QA'];
  const stepTemplates = [
    '1. Navigate to the affected page\n2. Perform the action\n3. Observe the error',
    '1. Log in as test user\n2. Try the feature\n3. Check the result',
    '1. Open the application\n2. Follow the steps to reproduce\n3. Note the behavior',
    '1. Set up the test environment\n2. Execute the operation\n3. Verify the outcome',
  ];

  // Function to generate a deterministic date based on index
  const getReportedDate = (index: number): string => {
    const baseDate = new Date('2025-01-01');
    const daysToAdd = index % 60; // Spread over ~2 months
    const date = new Date(baseDate);
    date.setDate(date.getDate() + daysToAdd);
    return date.toISOString().split('T')[0] + 'T00:00:00.000Z';
  };

  const bugsTable: TemplateTableSeed = {
    key: 'bugs',
    name: 'Bugs',
    description: 'Track bugs with severity, status, and components.',
    tableId: bugsTableId,
    fields: [
      { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
      {
        type: 'singleSelect',
        id: severityFieldId,
        name: 'Severity',
        options: {
          choices: severityOptions,
          defaultValue: 'Medium',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: statusFieldId,
        name: 'Status',
        options: {
          choices: statusOptions,
          defaultValue: 'New',
          preventAutoNewOptions: true,
        },
      },
      { type: 'singleLineText', id: environmentFieldId, name: 'Environment' },
      { type: 'longText', id: stepsFieldId, name: 'Steps to Repro' },
      {
        type: 'checkbox',
        id: reproducibleFieldId,
        name: 'Reproducible',
        options: { defaultValue: true },
      },
      { type: 'date', id: reportedAtFieldId, name: 'Reported At' },
      {
        type: 'link',
        id: componentLinkFieldId,
        name: 'Component',
        options: {
          relationship: 'manyOne',
          foreignTableId: componentsTableId,
          lookupFieldId: componentNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: componentLookupFieldId,
        name: 'Component Name',
        options: {
          linkFieldId: componentLinkFieldId,
          foreignTableId: componentsTableId,
          lookupFieldId: componentNameFieldId,
        },
      },
      {
        type: 'conditionalLookup',
        id: componentConditionalLookupFieldId,
        name: 'UI Components',
        options: {
          foreignTableId: componentsTableId,
          lookupFieldId: componentNameFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: componentNameFieldId,
                  operator: 'is',
                  value: 'UI',
                },
              ],
            },
          },
        },
      },
      {
        type: 'conditionalRollup',
        id: componentConditionalRollupFieldId,
        name: 'UI Component Count',
        options: {
          expression: 'count({values})',
        },
        config: {
          foreignTableId: componentsTableId,
          lookupFieldId: componentNameFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: componentNameFieldId,
                  operator: 'is',
                  value: 'UI',
                },
              ],
            },
          },
        },
      },
    ],
    defaultRecordCount: 100,
    // Use buildRecords to generate unique bug records
    buildRecords: (count: number) => {
      const records: NonNullable<ICreateTableRequestDto['records']> = [];

      for (let i = 0; i < count; i++) {
        // Cycle through components
        const componentIndex = i % componentNames.length;
        const componentName = componentNames[componentIndex]!;
        const componentId = componentRecordIds[componentName];
        const componentBugTitles = bugTitlesByComponent[componentName];

        // Get bug title - cycle through available titles for this component
        const titleIndex = Math.floor(i / componentNames.length) % componentBugTitles.length;
        const title = componentBugTitles[titleIndex]!;

        // Vary severity based on index
        const severityIndex = i % severityOptions.length;
        // Vary status based on index
        const statusIndex = i % statusOptions.length;
        // Vary environment
        const envIndex = i % environments.length;
        // Vary reproducibility
        const reproducible = i % 3 !== 0; // ~66% reproducible
        // Vary steps
        const stepsIndex = i % stepTemplates.length;

        records.push({
          fields: {
            [titleFieldId]: title,
            [severityFieldId]: severityOptions[severityIndex]!.id,
            [statusFieldId]: statusOptions[statusIndex]!.id,
            [environmentFieldId]: environments[envIndex]!,
            [stepsFieldId]: stepTemplates[stepsIndex]!,
            [reproducibleFieldId]: reproducible,
            [reportedAtFieldId]: getReportedDate(i),
            [componentLinkFieldId]: { id: componentId },
          },
        });
      }

      return records;
    },
    // Keep static records for preview/fallback
    records: [
      {
        fields: {
          [titleFieldId]: 'Login fails on retry',
          [severityFieldId]: severityOptions[2]!.id,
          [statusFieldId]: statusOptions[0]!.id,
          [environmentFieldId]: 'Production',
          [stepsFieldId]: 'Retry login twice and observe 500.',
          [reproducibleFieldId]: true,
          [reportedAtFieldId]: '2025-01-28T00:00:00.000Z',
          [componentLinkFieldId]: { id: componentRecordIds.auth },
        },
      },
      {
        fields: {
          [titleFieldId]: 'Tooltip overlaps content',
          [severityFieldId]: severityOptions[0]!.id,
          [statusFieldId]: statusOptions[1]!.id,
          [environmentFieldId]: 'Staging',
          [stepsFieldId]: 'Hover table header for 3s.',
          [reproducibleFieldId]: true,
          [reportedAtFieldId]: '2025-01-25T00:00:00.000Z',
          [componentLinkFieldId]: { id: componentRecordIds.ui },
        },
      },
      {
        fields: {
          [titleFieldId]: 'Export timeout',
          [severityFieldId]: severityOptions[3]!.id,
          [statusFieldId]: statusOptions[2]!.id,
          [environmentFieldId]: 'Production',
          [stepsFieldId]: 'Export 50k rows from dashboard.',
          [reproducibleFieldId]: false,
          [reportedAtFieldId]: '2025-01-22T00:00:00.000Z',
          [componentLinkFieldId]: { id: componentRecordIds.export },
        },
      },
    ],
  };

  return { tables: [bugsTable, componentsTable] };
};

export const bugTriageTemplate = createTemplate(
  'bug-triage',
  'Bug Triage',
  'Track bugs with severity, status, and ownership.',
  createBugTriageTemplateSeed,
  3
);
