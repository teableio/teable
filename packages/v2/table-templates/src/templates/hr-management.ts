/* eslint-disable sonarjs/no-duplicate-string */
import type { TemplateTableSeed, TemplateSeed } from '../types';
import {
  createFieldId,
  createRecordId,
  createSelectOption,
  createTableId,
  createTemplate,
} from '../utils';

const createHrManagementTemplateSeed = (): TemplateSeed => {
  const departmentsTableId = createTableId();
  const positionsTableId = createTableId();
  const employeesTableId = createTableId();
  const applicationsTableId = createTableId();
  const timeOffTableId = createTableId();
  const reviewsTableId = createTableId();

  const departmentNameFieldId = createFieldId();
  const departmentLeadFieldId = createFieldId();
  const departmentBudgetFieldId = createFieldId();
  const departmentLocationFieldId = createFieldId();
  const departmentHeadcountFieldId = createFieldId();
  const engineeringDepartmentRecordId = createRecordId();
  const peopleOpsDepartmentRecordId = createRecordId();

  const departmentsTable: TemplateTableSeed = {
    key: 'departments',
    name: 'Departments',
    description: 'Business units and owners.',
    tableId: departmentsTableId,
    fields: [
      { type: 'singleLineText', id: departmentNameFieldId, name: 'Name', isPrimary: true },
      { type: 'user', id: departmentLeadFieldId, name: 'Lead', options: { isMultiple: false } },
      {
        type: 'number',
        id: departmentBudgetFieldId,
        name: 'Budget',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      { type: 'singleLineText', id: departmentLocationFieldId, name: 'Location' },
      { type: 'number', id: departmentHeadcountFieldId, name: 'Headcount' },
    ],
    defaultRecordCount: 8,
    records: [
      {
        id: engineeringDepartmentRecordId,
        fields: {
          [departmentNameFieldId]: 'Engineering',
          [departmentBudgetFieldId]: 1200000,
          [departmentLocationFieldId]: 'San Francisco',
        },
      },
      {
        id: peopleOpsDepartmentRecordId,
        fields: {
          [departmentNameFieldId]: 'People Ops',
          [departmentBudgetFieldId]: 350000,
          [departmentLocationFieldId]: 'Remote',
        },
      },
    ],
  };

  const positionTitleFieldId = createFieldId();
  const positionDepartmentLinkFieldId = createFieldId();
  const positionDepartmentLookupFieldId = createFieldId();
  const positionTypeFieldId = createFieldId();
  const positionLevelFieldId = createFieldId();
  const positionOpeningsFieldId = createFieldId();
  const positionStatusFieldId = createFieldId();
  const positionHiringManagerFieldId = createFieldId();
  const positionSkillsFieldId = createFieldId();
  const frontendPositionRecordId = createRecordId();
  const peopleOpsPositionRecordId = createRecordId();

  const positionTypeOptions = [
    createSelectOption('Full-time', 'green'),
    createSelectOption('Part-time', 'yellow'),
    createSelectOption('Contract', 'purple'),
    createSelectOption('Intern', 'blue'),
  ];
  const positionLevelOptions = [
    createSelectOption('Junior', 'blue'),
    createSelectOption('Mid', 'teal'),
    createSelectOption('Senior', 'purple'),
    createSelectOption('Staff', 'orange'),
  ];
  const positionStatusOptions = [
    createSelectOption('Open', 'green'),
    createSelectOption('On Hold', 'yellow'),
    createSelectOption('Closed', 'red'),
  ];
  const skillOptions = [
    createSelectOption('TypeScript', 'blue'),
    createSelectOption('React', 'purple'),
    createSelectOption('People Ops', 'teal'),
    createSelectOption('Analytics', 'orange'),
  ];

  const positionsTable: TemplateTableSeed = {
    key: 'positions',
    name: 'Positions',
    description: 'Open roles and requisitions.',
    tableId: positionsTableId,
    fields: [
      { type: 'singleLineText', id: positionTitleFieldId, name: 'Title', isPrimary: true },
      {
        type: 'link',
        id: positionDepartmentLinkFieldId,
        name: 'Department',
        options: {
          relationship: 'manyOne',
          foreignTableId: departmentsTableId,
          lookupFieldId: departmentNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: positionDepartmentLookupFieldId,
        name: 'Department Name',
        options: {
          linkFieldId: positionDepartmentLinkFieldId,
          foreignTableId: departmentsTableId,
          lookupFieldId: departmentNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: positionTypeFieldId,
        name: 'Type',
        options: {
          choices: positionTypeOptions,
          defaultValue: 'Full-time',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: positionLevelFieldId,
        name: 'Level',
        options: {
          choices: positionLevelOptions,
          defaultValue: 'Mid',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'number',
        id: positionOpeningsFieldId,
        name: 'Openings',
        options: { defaultValue: 1 },
      },
      {
        type: 'singleSelect',
        id: positionStatusFieldId,
        name: 'Status',
        options: {
          choices: positionStatusOptions,
          defaultValue: 'Open',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'user',
        id: positionHiringManagerFieldId,
        name: 'Hiring Manager',
        options: { isMultiple: false },
      },
      {
        type: 'multipleSelect',
        id: positionSkillsFieldId,
        name: 'Core Skills',
        options: {
          choices: skillOptions,
          defaultValue: [skillOptions[0]!.name, skillOptions[1]!.name],
        },
      },
    ],
    defaultRecordCount: 30,
    records: [
      {
        id: frontendPositionRecordId,
        fields: {
          [positionTitleFieldId]: 'Senior Frontend Engineer',
          [positionDepartmentLinkFieldId]: { id: engineeringDepartmentRecordId },
          [positionTypeFieldId]: positionTypeOptions[0]!.id,
          [positionLevelFieldId]: positionLevelOptions[2]!.id,
          [positionOpeningsFieldId]: 2,
          [positionStatusFieldId]: positionStatusOptions[0]!.id,
          [positionSkillsFieldId]: [skillOptions[0]!.id, skillOptions[1]!.id],
        },
      },
      {
        id: peopleOpsPositionRecordId,
        fields: {
          [positionTitleFieldId]: 'People Operations Specialist',
          [positionDepartmentLinkFieldId]: { id: peopleOpsDepartmentRecordId },
          [positionTypeFieldId]: positionTypeOptions[0]!.id,
          [positionLevelFieldId]: positionLevelOptions[1]!.id,
          [positionOpeningsFieldId]: 1,
          [positionStatusFieldId]: positionStatusOptions[0]!.id,
          [positionSkillsFieldId]: [skillOptions[2]!.id],
        },
      },
    ],
  };

  const employeeNameFieldId = createFieldId();
  const employeeEmailFieldId = createFieldId();
  const employeePhoneFieldId = createFieldId();
  const employeeDepartmentLinkFieldId = createFieldId();
  const employeeDepartmentLookupFieldId = createFieldId();
  const employeePositionLinkFieldId = createFieldId();
  const employeePositionLookupFieldId = createFieldId();
  const employeeStatusFieldId = createFieldId();
  const employeeHireDateFieldId = createFieldId();
  const employeeManagerFieldId = createFieldId();
  const employeeSalaryFieldId = createFieldId();
  const employeeBonusFieldId = createFieldId();
  const employeeTotalCompFieldId = createFieldId();
  const employeeRatingFieldId = createFieldId();
  const employeeSkillsFieldId = createFieldId();
  const employeeIsFullTimeFieldId = createFieldId();
  const employeeContractFileFieldId = createFieldId();
  const employeeNotesFieldId = createFieldId();
  const rileyEmployeeRecordId = createRecordId();
  const morganEmployeeRecordId = createRecordId();

  const employeeStatusOptions = [
    createSelectOption('Active', 'green'),
    createSelectOption('On Leave', 'yellow'),
    createSelectOption('Terminated', 'red'),
  ];

  const employeesTable: TemplateTableSeed = {
    key: 'employees',
    name: 'Employees',
    description: 'Employee directory and core HR data.',
    tableId: employeesTableId,
    fields: [
      { type: 'singleLineText', id: employeeNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'singleLineText',
        id: employeeEmailFieldId,
        name: 'Email',
        options: { showAs: { type: 'email' } },
      },
      { type: 'singleLineText', id: employeePhoneFieldId, name: 'Phone' },
      {
        type: 'link',
        id: employeeDepartmentLinkFieldId,
        name: 'Department',
        options: {
          relationship: 'manyOne',
          foreignTableId: departmentsTableId,
          lookupFieldId: departmentNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: employeeDepartmentLookupFieldId,
        name: 'Department Name',
        options: {
          linkFieldId: employeeDepartmentLinkFieldId,
          foreignTableId: departmentsTableId,
          lookupFieldId: departmentNameFieldId,
        },
      },
      {
        type: 'link',
        id: employeePositionLinkFieldId,
        name: 'Position',
        options: {
          relationship: 'manyOne',
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
        },
      },
      {
        type: 'lookup',
        id: employeePositionLookupFieldId,
        name: 'Position Title',
        options: {
          linkFieldId: employeePositionLinkFieldId,
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: employeeStatusFieldId,
        name: 'Status',
        options: {
          choices: employeeStatusOptions,
          defaultValue: 'Active',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: employeeHireDateFieldId, name: 'Hire Date' },
      { type: 'user', id: employeeManagerFieldId, name: 'Manager', options: { isMultiple: false } },
      {
        type: 'number',
        id: employeeSalaryFieldId,
        name: 'Base Salary',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      {
        type: 'number',
        id: employeeBonusFieldId,
        name: 'Bonus',
        options: { formatting: { type: 'currency', precision: 0, symbol: '$' } },
      },
      {
        type: 'formula',
        id: employeeTotalCompFieldId,
        name: 'Total Compensation',
        options: {
          expression: `{${employeeSalaryFieldId}} + {${employeeBonusFieldId}}`,
          formatting: { type: 'currency', precision: 0, symbol: '$' },
        },
      },
      { type: 'rating', id: employeeRatingFieldId, name: 'Performance', max: 5 },
      {
        type: 'multipleSelect',
        id: employeeSkillsFieldId,
        name: 'Skills',
        options: {
          choices: skillOptions,
          defaultValue: [skillOptions[0]!.name],
        },
      },
      {
        type: 'checkbox',
        id: employeeIsFullTimeFieldId,
        name: 'Full Time',
        options: { defaultValue: true },
      },
      { type: 'attachment', id: employeeContractFileFieldId, name: 'Contract' },
      { type: 'longText', id: employeeNotesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 100,
    records: [
      {
        id: rileyEmployeeRecordId,
        fields: {
          [employeeNameFieldId]: 'Riley Chen',
          [employeeEmailFieldId]: 'riley@acme.example',
          [employeeDepartmentLinkFieldId]: { id: engineeringDepartmentRecordId },
          [employeePositionLinkFieldId]: { id: frontendPositionRecordId },
          [employeeStatusFieldId]: employeeStatusOptions[0]!.id,
          [employeeHireDateFieldId]: '2023-05-10T00:00:00.000Z',
          [employeeSalaryFieldId]: 165000,
          [employeeBonusFieldId]: 15000,
          [employeeRatingFieldId]: 4,
          [employeeSkillsFieldId]: [skillOptions[0]!.id, skillOptions[1]!.id],
        },
      },
      {
        id: morganEmployeeRecordId,
        fields: {
          [employeeNameFieldId]: 'Morgan Patel',
          [employeeEmailFieldId]: 'morgan@acme.example',
          [employeeDepartmentLinkFieldId]: { id: peopleOpsDepartmentRecordId },
          [employeePositionLinkFieldId]: { id: peopleOpsPositionRecordId },
          [employeeStatusFieldId]: employeeStatusOptions[1]!.id,
          [employeeHireDateFieldId]: '2022-11-01T00:00:00.000Z',
          [employeeSalaryFieldId]: 95000,
          [employeeBonusFieldId]: 8000,
          [employeeRatingFieldId]: 5,
          [employeeSkillsFieldId]: [skillOptions[2]!.id],
        },
      },
    ],
  };

  const applicationCandidateFieldId = createFieldId();
  const applicationEmailFieldId = createFieldId();
  const applicationPositionLinkFieldId = createFieldId();
  const applicationPositionLookupFieldId = createFieldId();
  const applicationPositionOpeningsFieldId = createFieldId();
  const applicationOpenPositionCountFieldId = createFieldId();
  const applicationStageFieldId = createFieldId();
  const applicationSourceFieldId = createFieldId();
  const applicationResumeFieldId = createFieldId();
  const applicationScoreFieldId = createFieldId();
  const applicationOfferSentFieldId = createFieldId();
  const applicationNotesFieldId = createFieldId();
  const applicationActionFieldId = createFieldId();

  const applicationStageOptions = [
    createSelectOption('Applied', 'blue'),
    createSelectOption('Screen', 'yellow'),
    createSelectOption('Interview', 'purple'),
    createSelectOption('Offer', 'green'),
    createSelectOption('Hired', 'teal'),
    createSelectOption('Rejected', 'red'),
  ];
  const applicationSourceOptions = [
    createSelectOption('Referral', 'green'),
    createSelectOption('LinkedIn', 'blue'),
    createSelectOption('Inbound', 'purple'),
    createSelectOption('Agency', 'orange'),
  ];

  const applicationsTable: TemplateTableSeed = {
    key: 'applications',
    name: 'Applications',
    description: 'Candidates and recruiting pipeline.',
    tableId: applicationsTableId,
    fields: [
      {
        type: 'singleLineText',
        id: applicationCandidateFieldId,
        name: 'Candidate',
        isPrimary: true,
      },
      {
        type: 'singleLineText',
        id: applicationEmailFieldId,
        name: 'Email',
        options: { showAs: { type: 'email' } },
      },
      {
        type: 'link',
        id: applicationPositionLinkFieldId,
        name: 'Position',
        options: {
          relationship: 'manyOne',
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
        },
      },
      {
        type: 'lookup',
        id: applicationPositionLookupFieldId,
        name: 'Position Title',
        options: {
          linkFieldId: applicationPositionLinkFieldId,
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
        },
      },
      {
        type: 'rollup',
        id: applicationPositionOpeningsFieldId,
        name: 'Position Openings',
        options: { expression: 'sum({values})' },
        config: {
          linkFieldId: applicationPositionLinkFieldId,
          foreignTableId: positionsTableId,
          lookupFieldId: positionOpeningsFieldId,
        },
      },
      {
        type: 'conditionalRollup',
        id: applicationOpenPositionCountFieldId,
        name: 'Open Position Count',
        options: { expression: 'count({values})' },
        config: {
          foreignTableId: positionsTableId,
          lookupFieldId: positionTitleFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: positionStatusFieldId,
                  operator: 'is',
                  value: positionStatusOptions[0]!.id,
                },
              ],
            },
          },
        },
      },
      {
        type: 'singleSelect',
        id: applicationStageFieldId,
        name: 'Stage',
        options: {
          choices: applicationStageOptions,
          defaultValue: 'Applied',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: applicationSourceFieldId,
        name: 'Source',
        options: {
          choices: applicationSourceOptions,
          defaultValue: 'Inbound',
          preventAutoNewOptions: true,
        },
      },
      { type: 'attachment', id: applicationResumeFieldId, name: 'Resume' },
      {
        type: 'number',
        id: applicationScoreFieldId,
        name: 'Score',
        options: { formatting: { type: 'decimal', precision: 0 } },
      },
      {
        type: 'checkbox',
        id: applicationOfferSentFieldId,
        name: 'Offer Sent',
        options: { defaultValue: false },
      },
      { type: 'longText', id: applicationNotesFieldId, name: 'Notes' },
      {
        type: 'button',
        id: applicationActionFieldId,
        name: 'Send Offer',
        options: {
          label: 'Send Offer',
          color: 'teal',
          maxCount: 1,
          resetCount: false,
        },
      },
    ],
    defaultRecordCount: 60,
    records: [
      {
        fields: {
          [applicationCandidateFieldId]: 'Jamie Rivera',
          [applicationEmailFieldId]: 'jamie.rivera@example.com',
          [applicationPositionLinkFieldId]: { id: frontendPositionRecordId },
          [applicationStageFieldId]: applicationStageOptions[2]!.id,
          [applicationSourceFieldId]: applicationSourceOptions[1]!.id,
          [applicationScoreFieldId]: 4,
          [applicationOfferSentFieldId]: false,
        },
      },
      {
        fields: {
          [applicationCandidateFieldId]: 'Casey Nguyen',
          [applicationEmailFieldId]: 'casey.nguyen@example.com',
          [applicationPositionLinkFieldId]: { id: peopleOpsPositionRecordId },
          [applicationStageFieldId]: applicationStageOptions[3]!.id,
          [applicationSourceFieldId]: applicationSourceOptions[0]!.id,
          [applicationScoreFieldId]: 5,
          [applicationOfferSentFieldId]: true,
        },
      },
    ],
  };

  const timeOffEmployeeLinkFieldId = createFieldId();
  const timeOffEmployeeLookupFieldId = createFieldId();
  const timeOffNameFieldId = createFieldId();
  const timeOffTypeFieldId = createFieldId();
  const timeOffStatusFieldId = createFieldId();
  const timeOffStartFieldId = createFieldId();
  const timeOffEndFieldId = createFieldId();
  const timeOffApprovedByFieldId = createFieldId();
  const timeOffNotesFieldId = createFieldId();

  const timeOffTypeOptions = [
    createSelectOption('Vacation', 'blue'),
    createSelectOption('Sick', 'red'),
    createSelectOption('Parental', 'purple'),
    createSelectOption('Unpaid', 'orange'),
  ];
  const timeOffStatusOptions = [
    createSelectOption('Requested', 'yellow'),
    createSelectOption('Approved', 'green'),
    createSelectOption('Declined', 'red'),
  ];

  const timeOffTable: TemplateTableSeed = {
    key: 'time-off',
    name: 'Time Off',
    description: 'Leave requests and balances.',
    tableId: timeOffTableId,
    fields: [
      { type: 'singleLineText', id: timeOffNameFieldId, name: 'Request', isPrimary: true },
      {
        type: 'link',
        id: timeOffEmployeeLinkFieldId,
        name: 'Employee',
        options: {
          relationship: 'manyOne',
          foreignTableId: employeesTableId,
          lookupFieldId: employeeNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: timeOffEmployeeLookupFieldId,
        name: 'Employee Name',
        options: {
          linkFieldId: timeOffEmployeeLinkFieldId,
          foreignTableId: employeesTableId,
          lookupFieldId: employeeNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: timeOffTypeFieldId,
        name: 'Type',
        options: {
          choices: timeOffTypeOptions,
          defaultValue: 'Vacation',
          preventAutoNewOptions: true,
        },
      },
      {
        type: 'singleSelect',
        id: timeOffStatusFieldId,
        name: 'Status',
        options: {
          choices: timeOffStatusOptions,
          defaultValue: 'Requested',
          preventAutoNewOptions: true,
        },
      },
      { type: 'date', id: timeOffStartFieldId, name: 'Start Date' },
      { type: 'date', id: timeOffEndFieldId, name: 'End Date' },
      {
        type: 'user',
        id: timeOffApprovedByFieldId,
        name: 'Approved By',
        options: { isMultiple: false },
      },
      { type: 'longText', id: timeOffNotesFieldId, name: 'Notes' },
    ],
    defaultRecordCount: 40,
    records: [
      {
        fields: {
          [timeOffNameFieldId]: 'Spring vacation',
          [timeOffEmployeeLinkFieldId]: { id: rileyEmployeeRecordId },
          [timeOffTypeFieldId]: timeOffTypeOptions[0]!.id,
          [timeOffStatusFieldId]: timeOffStatusOptions[1]!.id,
          [timeOffStartFieldId]: '2025-03-04T00:00:00.000Z',
          [timeOffEndFieldId]: '2025-03-08T00:00:00.000Z',
        },
      },
      {
        fields: {
          [timeOffNameFieldId]: 'Parental leave',
          [timeOffEmployeeLinkFieldId]: { id: morganEmployeeRecordId },
          [timeOffTypeFieldId]: timeOffTypeOptions[2]!.id,
          [timeOffStatusFieldId]: timeOffStatusOptions[0]!.id,
          [timeOffStartFieldId]: '2025-04-01T00:00:00.000Z',
          [timeOffEndFieldId]: '2025-04-21T00:00:00.000Z',
        },
      },
    ],
  };

  const reviewEmployeeLinkFieldId = createFieldId();
  const reviewEmployeeLookupFieldId = createFieldId();
  const reviewNameFieldId = createFieldId();
  const reviewPeriodFieldId = createFieldId();
  const reviewScoreFieldId = createFieldId();
  const reviewReviewerFieldId = createFieldId();
  const reviewStrengthsFieldId = createFieldId();
  const reviewAreasFieldId = createFieldId();
  const reviewGoalsFieldId = createFieldId();

  const reviewGoalOptions = [
    createSelectOption('Leadership', 'purple'),
    createSelectOption('Delivery', 'green'),
    createSelectOption('Communication', 'blue'),
  ];

  const reviewsTable: TemplateTableSeed = {
    key: 'reviews',
    name: 'Performance Reviews',
    description: 'Periodic performance reviews.',
    tableId: reviewsTableId,
    fields: [
      { type: 'singleLineText', id: reviewNameFieldId, name: 'Review', isPrimary: true },
      {
        type: 'link',
        id: reviewEmployeeLinkFieldId,
        name: 'Employee',
        options: {
          relationship: 'manyOne',
          foreignTableId: employeesTableId,
          lookupFieldId: employeeNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: reviewEmployeeLookupFieldId,
        name: 'Employee Name',
        options: {
          linkFieldId: reviewEmployeeLinkFieldId,
          foreignTableId: employeesTableId,
          lookupFieldId: employeeNameFieldId,
        },
      },
      {
        type: 'singleSelect',
        id: reviewPeriodFieldId,
        name: 'Period',
        options: {
          choices: [createSelectOption('H1 2025', 'blue'), createSelectOption('H2 2025', 'purple')],
          defaultValue: 'H1 2025',
          preventAutoNewOptions: true,
        },
      },
      { type: 'rating', id: reviewScoreFieldId, name: 'Score', max: 5 },
      { type: 'user', id: reviewReviewerFieldId, name: 'Reviewer', options: { isMultiple: false } },
      { type: 'longText', id: reviewStrengthsFieldId, name: 'Strengths' },
      { type: 'longText', id: reviewAreasFieldId, name: 'Growth Areas' },
      {
        type: 'multipleSelect',
        id: reviewGoalsFieldId,
        name: 'Goals',
        options: {
          choices: reviewGoalOptions,
          defaultValue: [reviewGoalOptions[1]!.name],
        },
      },
    ],
    defaultRecordCount: 20,
    records: [
      {
        fields: {
          [reviewNameFieldId]: 'H1 2025 Review - Riley',
          [reviewEmployeeLinkFieldId]: { id: rileyEmployeeRecordId },
          [reviewScoreFieldId]: 4,
          [reviewStrengthsFieldId]: 'Strong delivery and collaboration.',
          [reviewAreasFieldId]: 'Expand cross-team influence.',
          [reviewGoalsFieldId]: [reviewGoalOptions[0]!.id],
        },
      },
      {
        fields: {
          [reviewNameFieldId]: 'H1 2025 Review - Morgan',
          [reviewEmployeeLinkFieldId]: { id: morganEmployeeRecordId },
          [reviewScoreFieldId]: 5,
          [reviewStrengthsFieldId]: 'Exceptional ownership and mentorship.',
          [reviewAreasFieldId]: 'Maintain sustainable pace.',
          [reviewGoalsFieldId]: [reviewGoalOptions[1]!.id],
        },
      },
    ],
  };

  return {
    tables: [
      departmentsTable,
      positionsTable,
      employeesTable,
      applicationsTable,
      timeOffTable,
      reviewsTable,
    ],
  };
};

export const hrManagementTemplate = createTemplate(
  'hr-management',
  'HR Management',
  'HR management with departments, positions, employees, applications, time off, and performance reviews.',
  createHrManagementTemplateSeed,
  2
);
