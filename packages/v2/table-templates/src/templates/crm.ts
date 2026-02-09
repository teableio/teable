/* eslint-disable sonarjs/no-duplicate-string */
import type { TemplateTableSeed, TemplateSeed } from '../types';
import {
  createFieldId,
  createRecordId,
  createSelectOption,
  createTableId,
  createTemplate,
} from '../utils';

const createCrmHubspotTemplateSeed = (): TemplateSeed => {
  const companiesTableId = createTableId();
  const contactsTableId = createTableId();
  const dealsTableId = createTableId();
  const ticketsTableId = createTableId();
  const activitiesTableId = createTableId();

  const companyNameFieldId = createFieldId();
  const companyDomainFieldId = createFieldId();
  const companyWebsiteFieldId = createFieldId();
  const industryFieldId = createFieldId();
  const accountTierFieldId = createFieldId();
  const accountStatusFieldId = createFieldId();
  const lifecycleStageFieldId = createFieldId();
  const regionFieldId = createFieldId();
  const companyRevenueFieldId = createFieldId();
  const companyEmployeeCountFieldId = createFieldId();
  const companyPhoneFieldId = createFieldId();
  const companyCityFieldId = createFieldId();
  const companyCountryFieldId = createFieldId();
  const companyOwnerFieldId = createFieldId();
  const companyNotesFieldId = createFieldId();
  const companyCreatedAtFieldId = createFieldId();

  const industryOptions = [
    createSelectOption('SaaS', 'blue'),
    createSelectOption('E-commerce', 'purple'),
    createSelectOption('Fintech', 'teal'),
    createSelectOption('Healthcare', 'orange'),
  ];
  const tierOptions = [
    createSelectOption('Enterprise', 'red'),
    createSelectOption('Mid-Market', 'yellow'),
    createSelectOption('SMB', 'green'),
  ];
  const accountStatusOptions = [
    createSelectOption('Prospect', 'blue'),
    createSelectOption('Customer', 'green'),
    createSelectOption('Churned', 'red'),
  ];
  const lifecycleStageOptions = [
    createSelectOption('Subscriber', 'blue'),
    createSelectOption('Lead', 'yellow'),
    createSelectOption('MQL', 'orange'),
    createSelectOption('SQL', 'purple'),
    createSelectOption('Opportunity', 'teal'),
    createSelectOption('Customer', 'green'),
    createSelectOption('Evangelist', 'blue'),
  ];
  const regionOptions = [
    createSelectOption('North America', 'teal'),
    createSelectOption('EMEA', 'purple'),
    createSelectOption('APAC', 'orange'),
  ];

  const acmeCompanyRecordId = createRecordId();
  const northwindCompanyRecordId = createRecordId();
  const adaContactRecordId = createRecordId();
  const graceContactRecordId = createRecordId();
  const acmeDealRecordId = createRecordId();
  const northwindDealRecordId = createRecordId();

  const companiesTable: TemplateTableSeed = {
    key: 'companies',
    name: 'Companies',
    description: 'Accounts you sell to.',
    tableId: companiesTableId,
    fields: [
      { type: 'singleLineText', id: companyNameFieldId, name: 'Name', isPrimary: true },
      { type: 'singleLineText', id: companyDomainFieldId, name: 'Domain' },
      {
        type: 'singleLineText',
        id: companyWebsiteFieldId,
        name: 'Website',
        options: { showAs: { type: 'url' } },
      },
      {
        type: 'singleSelect',
        id: industryFieldId,
        name: 'Industry',
        options: {
          choices: industryOptions,
          defaultValue: 'SaaS',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: accountTierFieldId,
        name: 'Account Tier',
        options: {
          choices: tierOptions,
          defaultValue: 'Mid-Market',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: accountStatusFieldId,
        name: 'Account Status',
        options: {
          choices: accountStatusOptions,
          defaultValue: 'Prospect',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: lifecycleStageFieldId,
        name: 'Lifecycle Stage',
        options: {
          choices: lifecycleStageOptions,
          defaultValue: 'Lead',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: regionFieldId,
        name: 'Region',
        options: {
          choices: regionOptions,
          defaultValue: 'North America',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'number',
        id: companyRevenueFieldId,
        name: 'Annual Revenue',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      { type: 'number', id: companyEmployeeCountFieldId, name: 'Employee Count' },
      { type: 'singleLineText', id: companyPhoneFieldId, name: 'Phone' },
      { type: 'singleLineText', id: companyCityFieldId, name: 'City' },
      { type: 'singleLineText', id: companyCountryFieldId, name: 'Country' },
      { type: 'user', id: companyOwnerFieldId, name: 'Owner', options: { isMultiple: false } },
      { type: 'longText', id: companyNotesFieldId, name: 'Notes' },
      { type: 'date', id: companyCreatedAtFieldId, name: 'Created At' },
    ],
    defaultRecordCount: 30,
    records: [
      {
        id: acmeCompanyRecordId,
        fields: {
          [companyNameFieldId]: 'Acme Inc.',
          [companyWebsiteFieldId]: 'https://acme.example',
          [companyDomainFieldId]: 'acme.example',
          [industryFieldId]: industryOptions[0]!.id,
          [accountTierFieldId]: tierOptions[1]!.id,
          [accountStatusFieldId]: accountStatusOptions[0]!.id,
          [lifecycleStageFieldId]: lifecycleStageOptions[2]!.id,
          [regionFieldId]: regionOptions[0]!.id,
          [companyRevenueFieldId]: 1200000,
          [companyEmployeeCountFieldId]: 420,
          [companyPhoneFieldId]: '+1-555-0183',
          [companyCityFieldId]: 'San Francisco',
          [companyCountryFieldId]: 'USA',
          [companyCreatedAtFieldId]: '2025-01-10T00:00:00.000Z',
        },
      },
      {
        id: northwindCompanyRecordId,
        fields: {
          [companyNameFieldId]: 'Northwind Traders',
          [companyWebsiteFieldId]: 'https://northwind.example',
          [companyDomainFieldId]: 'northwind.example',
          [industryFieldId]: industryOptions[1]!.id,
          [accountTierFieldId]: tierOptions[2]!.id,
          [accountStatusFieldId]: accountStatusOptions[1]!.id,
          [lifecycleStageFieldId]: lifecycleStageOptions[5]!.id,
          [regionFieldId]: regionOptions[1]!.id,
          [companyRevenueFieldId]: 450000,
          [companyEmployeeCountFieldId]: 120,
          [companyPhoneFieldId]: '+44-20-7946-0958',
          [companyCityFieldId]: 'London',
          [companyCountryFieldId]: 'UK',
          [companyCreatedAtFieldId]: '2024-12-01T00:00:00.000Z',
        },
      },
    ],
  };

  const contactNameFieldId = createFieldId();
  const contactTitleFieldId = createFieldId();
  const contactEmailFieldId = createFieldId();
  const contactPhoneFieldId = createFieldId();
  const contactCompanyLinkFieldId = createFieldId();
  const contactCompanyLookupFieldId = createFieldId();
  const leadStatusFieldId = createFieldId();
  const contactLifecycleStageFieldId = createFieldId();
  const lastContactedFieldId = createFieldId();
  const contactNotesFieldId = createFieldId();

  const leadStatusOptions = [
    createSelectOption('New', 'blue'),
    createSelectOption('Open', 'yellow'),
    createSelectOption('In Progress', 'purple'),
    createSelectOption('Open Deal', 'teal'),
    createSelectOption('Unqualified', 'red'),
  ];
  const contactLifecycleStageOptions = [
    createSelectOption('Subscriber', 'blue'),
    createSelectOption('Lead', 'yellow'),
    createSelectOption('MQL', 'orange'),
    createSelectOption('SQL', 'purple'),
    createSelectOption('Opportunity', 'teal'),
    createSelectOption('Customer', 'green'),
  ];

  const contactsTable: TemplateTableSeed = {
    key: 'contacts',
    name: 'Contacts',
    description: 'People at your accounts.',
    tableId: contactsTableId,
    fields: [
      { type: 'singleLineText', id: contactNameFieldId, name: 'Name', isPrimary: true },
      { type: 'singleLineText', id: contactTitleFieldId, name: 'Title' },
      {
        type: 'singleLineText',
        id: contactEmailFieldId,
        name: 'Email',
        options: { showAs: { type: 'email' } },
      },
      { type: 'singleLineText', id: contactPhoneFieldId, name: 'Phone' },
      {
        type: 'link',
        id: contactCompanyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: contactCompanyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: contactCompanyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: leadStatusFieldId,
        name: 'Lead Status',
        options: {
          choices: leadStatusOptions,
          defaultValue: 'New',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: contactLifecycleStageFieldId,
        name: 'Lifecycle Stage',
        options: {
          choices: contactLifecycleStageOptions,
          defaultValue: 'Lead',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: lastContactedFieldId, name: 'Last Contacted' },
      { type: 'longText', id: contactNotesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 80,
    records: [
      {
        id: adaContactRecordId,
        fields: {
          [contactNameFieldId]: 'Ada Lovelace',
          [contactTitleFieldId]: 'Head of Data',
          [contactEmailFieldId]: 'ada@acme.example',
          [contactCompanyLinkFieldId]: { id: acmeCompanyRecordId },
          [leadStatusFieldId]: leadStatusOptions[2]!.id,
          [contactLifecycleStageFieldId]: contactLifecycleStageOptions[2]!.id,
          [lastContactedFieldId]: '2025-02-02T00:00:00.000Z',
        },
      },
      {
        id: graceContactRecordId,
        fields: {
          [contactNameFieldId]: 'Grace Hopper',
          [contactTitleFieldId]: 'VP Engineering',
          [contactEmailFieldId]: 'grace@northwind.example',
          [contactCompanyLinkFieldId]: { id: northwindCompanyRecordId },
          [leadStatusFieldId]: leadStatusOptions[3]!.id,
          [contactLifecycleStageFieldId]: contactLifecycleStageOptions[5]!.id,
          [lastContactedFieldId]: '2025-01-20T00:00:00.000Z',
        },
      },
    ],
  };

  const dealNameFieldId = createFieldId();
  const dealCompanyLinkFieldId = createFieldId();
  const dealCompanyLookupFieldId = createFieldId();
  const dealPrimaryContactLinkFieldId = createFieldId();
  const dealAmountFieldId = createFieldId();
  const dealPipelineFieldId = createFieldId();
  const dealStageFieldId = createFieldId();
  const dealProbabilityFieldId = createFieldId();
  const dealExpectedValueFieldId = createFieldId();
  const dealCloseDateFieldId = createFieldId();
  const dealOwnerFieldId = createFieldId();
  const dealNextStepFieldId = createFieldId();
  const dealForecastCategoryFieldId = createFieldId();

  const dealStageOptions = [
    createSelectOption('Prospecting', 'blue'),
    createSelectOption('Qualification', 'yellow'),
    createSelectOption('Proposal', 'purple'),
    createSelectOption('Negotiation', 'orange'),
    createSelectOption('Closed Won', 'green'),
    createSelectOption('Closed Lost', 'red'),
  ];
  const pipelineOptions = [
    createSelectOption('Sales Pipeline', 'blue'),
    createSelectOption('Renewals', 'purple'),
  ];
  const forecastCategoryOptions = [
    createSelectOption('Pipeline', 'blue'),
    createSelectOption('Best Case', 'yellow'),
    createSelectOption('Commit', 'green'),
    createSelectOption('Omitted', 'red'),
  ];

  const dealsTable: TemplateTableSeed = {
    key: 'deals',
    name: 'Deals',
    description: 'Active opportunities and pipeline.',
    tableId: dealsTableId,
    fields: [
      { type: 'singleLineText', id: dealNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: dealCompanyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: dealCompanyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: dealCompanyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'link',
        id: dealPrimaryContactLinkFieldId,
        name: 'Primary Contact',
        options: {
          relationship: 'manyOne',
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'number',
        id: dealAmountFieldId,
        name: 'Amount',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      {
        type: 'singleSelect',
        id: dealPipelineFieldId,
        name: 'Pipeline',
        options: {
          choices: pipelineOptions,
          defaultValue: 'Sales Pipeline',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: dealStageFieldId,
        name: 'Stage',
        options: {
          choices: dealStageOptions,
          defaultValue: 'Prospecting',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'number',
        id: dealProbabilityFieldId,
        name: 'Probability',
        options: { formatting: { type: 'decimal', precision: 0 } },
      },
      {
        type: 'formula',
        id: dealExpectedValueFieldId,
        name: 'Expected Value',
        options: {
          expression: `{${dealAmountFieldId}} * {${dealProbabilityFieldId}} / 100`,
          formatting: { type: 'currency', precision: 0, symbol: '$' },
        },
      },
      { type: 'date', id: dealCloseDateFieldId, name: 'Close Date' },
      { type: 'user', id: dealOwnerFieldId, name: 'Owner', options: { isMultiple: false } },
      { type: 'singleLineText', id: dealNextStepFieldId, name: 'Next Step' },
      {
        type: 'singleSelect',
        id: dealForecastCategoryFieldId,
        name: 'Forecast Category',
        options: {
          choices: forecastCategoryOptions,
          defaultValue: 'Pipeline',
          preventAutoNewOptions: true,
        },
      },
    ],
    defaultRecordCount: 60,
    records: [
      {
        id: acmeDealRecordId,
        fields: {
          [dealNameFieldId]: 'Acme Expansion',
          [dealCompanyLinkFieldId]: { id: acmeCompanyRecordId },
          [dealPrimaryContactLinkFieldId]: { id: adaContactRecordId },
          [dealAmountFieldId]: 240000,
          [dealPipelineFieldId]: pipelineOptions[0]!.id,
          [dealStageFieldId]: dealStageOptions[2]!.id,
          [dealProbabilityFieldId]: 40,
          [dealCloseDateFieldId]: '2025-03-15T00:00:00.000Z',
          [dealForecastCategoryFieldId]: forecastCategoryOptions[0]!.id,
          [dealNextStepFieldId]: 'Schedule security review',
        },
      },
      {
        id: northwindDealRecordId,
        fields: {
          [dealNameFieldId]: 'Northwind Renewal',
          [dealCompanyLinkFieldId]: { id: northwindCompanyRecordId },
          [dealPrimaryContactLinkFieldId]: { id: graceContactRecordId },
          [dealAmountFieldId]: 90000,
          [dealPipelineFieldId]: pipelineOptions[1]!.id,
          [dealStageFieldId]: dealStageOptions[4]!.id,
          [dealProbabilityFieldId]: 85,
          [dealCloseDateFieldId]: '2025-02-28T00:00:00.000Z',
          [dealForecastCategoryFieldId]: forecastCategoryOptions[2]!.id,
          [dealNextStepFieldId]: 'Send final order form',
        },
      },
    ],
  };

  const activitySubjectFieldId = createFieldId();
  const activityTypeFieldId = createFieldId();
  const activityStatusFieldId = createFieldId();
  const activityDueDateFieldId = createFieldId();
  const activityCompanyLinkFieldId = createFieldId();
  const activityCompanyLookupFieldId = createFieldId();
  const activityContactLinkFieldId = createFieldId();
  const activityContactLookupFieldId = createFieldId();
  const activityDealLinkFieldId = createFieldId();
  const activityDealLookupFieldId = createFieldId();
  const activityNotesFieldId = createFieldId();
  const activityOwnerFieldId = createFieldId();

  const activityTypeOptions = [
    createSelectOption('Call', 'blue'),
    createSelectOption('Email', 'purple'),
    createSelectOption('Meeting', 'green'),
    createSelectOption('Task', 'orange'),
  ];
  const activityStatusOptions = [
    createSelectOption('Planned', 'yellow'),
    createSelectOption('Completed', 'green'),
  ];

  const activitiesTable: TemplateTableSeed = {
    key: 'activities',
    name: 'Activities',
    description: 'Calls, meetings, and tasks tied to pipeline.',
    tableId: activitiesTableId,
    fields: [
      { type: 'singleLineText', id: activitySubjectFieldId, name: 'Subject', isPrimary: true },
      {
        type: 'singleSelect',
        id: activityTypeFieldId,
        name: 'Type',
        options: {
          choices: activityTypeOptions,
          defaultValue: 'Call',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: activityStatusFieldId,
        name: 'Status',
        options: {
          choices: activityStatusOptions,
          defaultValue: 'Planned',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: activityDueDateFieldId, name: 'Due Date' },
      {
        type: 'link',
        id: activityCompanyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: activityCompanyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: activityCompanyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'link',
        id: activityContactLinkFieldId,
        name: 'Contact',
        options: {
          relationship: 'manyOne',
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: activityContactLookupFieldId,
        name: 'Contact Name',
        options: {
          linkFieldId: activityContactLinkFieldId,
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'link',
        id: activityDealLinkFieldId,
        name: 'Deal',
        options: {
          relationship: 'manyOne',
          foreignTableId: dealsTableId,
          lookupFieldId: dealNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: activityDealLookupFieldId,
        name: 'Deal Name',
        options: {
          linkFieldId: activityDealLinkFieldId,
          foreignTableId: dealsTableId,
          lookupFieldId: dealNameFieldId,
        },
      },
      { type: 'longText', id: activityNotesFieldId, name: 'Notes' },
      { type: 'user', id: activityOwnerFieldId, name: 'Owner', options: { isMultiple: false } },
    ],
    defaultRecordCount: 100,
    records: [
      {
        fields: {
          [activitySubjectFieldId]: 'Discovery call with Acme',
          [activityTypeFieldId]: activityTypeOptions[0]!.id,
          [activityStatusFieldId]: activityStatusOptions[1]!.id,
          [activityDueDateFieldId]: '2025-02-01T00:00:00.000Z',
          [activityCompanyLinkFieldId]: { id: acmeCompanyRecordId },
          [activityContactLinkFieldId]: { id: adaContactRecordId },
          [activityDealLinkFieldId]: { id: acmeDealRecordId },
        },
      },
      {
        fields: {
          [activitySubjectFieldId]: 'Send renewal proposal',
          [activityTypeFieldId]: activityTypeOptions[3]!.id,
          [activityStatusFieldId]: activityStatusOptions[0]!.id,
          [activityDueDateFieldId]: '2025-02-10T00:00:00.000Z',
          [activityCompanyLinkFieldId]: { id: northwindCompanyRecordId },
          [activityContactLinkFieldId]: { id: graceContactRecordId },
          [activityDealLinkFieldId]: { id: northwindDealRecordId },
        },
      },
    ],
  };

  const ticketNameFieldId = createFieldId();
  const ticketCompanyLinkFieldId = createFieldId();
  const ticketCompanyLookupFieldId = createFieldId();
  const ticketContactLinkFieldId = createFieldId();
  const ticketContactLookupFieldId = createFieldId();
  const ticketPipelineFieldId = createFieldId();
  const ticketStatusFieldId = createFieldId();
  const ticketPriorityFieldId = createFieldId();
  const ticketOwnerFieldId = createFieldId();
  const ticketCreatedAtFieldId = createFieldId();
  const ticketClosedAtFieldId = createFieldId();
  const ticketNotesFieldId = createFieldId();

  const ticketPipelineOptions = [
    createSelectOption('Support Pipeline', 'blue'),
    createSelectOption('Onboarding', 'green'),
  ];
  const ticketStatusOptions = [
    createSelectOption('New', 'blue'),
    createSelectOption('Waiting on Contact', 'yellow'),
    createSelectOption('Waiting on Us', 'purple'),
    createSelectOption('Closed', 'green'),
  ];
  const ticketPriorityOptions = [
    createSelectOption('Low', 'green'),
    createSelectOption('Medium', 'yellow'),
    createSelectOption('High', 'red'),
  ];

  const ticketsTable: TemplateTableSeed = {
    key: 'tickets',
    name: 'Tickets',
    description: 'Support and onboarding tickets.',
    tableId: ticketsTableId,
    fields: [
      { type: 'singleLineText', id: ticketNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: ticketCompanyLinkFieldId,
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: ticketCompanyLookupFieldId,
        name: 'Company Name',
        options: {
          linkFieldId: ticketCompanyLinkFieldId,
          foreignTableId: companiesTableId,
          lookupFieldId: companyNameFieldId,
        },
      },
      {
        type: 'link',
        id: ticketContactLinkFieldId,
        name: 'Contact',
        options: {
          relationship: 'manyOne',
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: ticketContactLookupFieldId,
        name: 'Contact Name',
        options: {
          linkFieldId: ticketContactLinkFieldId,
          foreignTableId: contactsTableId,
          lookupFieldId: contactNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: ticketPipelineFieldId,
        name: 'Pipeline',
        options: {
          choices: ticketPipelineOptions,
          defaultValue: 'Support Pipeline',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: ticketStatusFieldId,
        name: 'Status',
        options: {
          choices: ticketStatusOptions,
          defaultValue: 'New',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: ticketPriorityFieldId,
        name: 'Priority',
        options: {
          choices: ticketPriorityOptions,
          defaultValue: 'Medium',
          preventAutoNewOptions: true,
        },
      },
      { type: 'user', id: ticketOwnerFieldId, name: 'Owner', options: { isMultiple: false } },
      { type: 'date', id: ticketCreatedAtFieldId, name: 'Created At' },
      { type: 'date', id: ticketClosedAtFieldId, name: 'Closed At' },
      { type: 'longText', id: ticketNotesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 40,
    records: [
      {
        fields: {
          [ticketNameFieldId]: 'Onboarding: import legacy data',
          [ticketCompanyLinkFieldId]: { id: acmeCompanyRecordId },
          [ticketContactLinkFieldId]: { id: adaContactRecordId },
          [ticketPipelineFieldId]: ticketPipelineOptions[1]!.id,
          [ticketStatusFieldId]: ticketStatusOptions[1]!.id,
          [ticketPriorityFieldId]: ticketPriorityOptions[1]!.id,
          [ticketCreatedAtFieldId]: '2025-01-12T00:00:00.000Z',
        },
      },
      {
        fields: {
          [ticketNameFieldId]: 'Support: SSO setup',
          [ticketCompanyLinkFieldId]: { id: northwindCompanyRecordId },
          [ticketContactLinkFieldId]: { id: graceContactRecordId },
          [ticketPipelineFieldId]: ticketPipelineOptions[0]!.id,
          [ticketStatusFieldId]: ticketStatusOptions[2]!.id,
          [ticketPriorityFieldId]: ticketPriorityOptions[2]!.id,
          [ticketCreatedAtFieldId]: '2025-01-28T00:00:00.000Z',
        },
      },
    ],
  };

  return { tables: [companiesTable, contactsTable, dealsTable, ticketsTable, activitiesTable] };
};

export const crmTemplate = createTemplate(
  'crm',
  'CRM (HubSpot)',
  'HubSpot-style CRM with companies, contacts, deals, tickets, and activities.',
  createCrmHubspotTemplateSeed,
  2
);
