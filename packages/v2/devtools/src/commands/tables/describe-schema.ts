import { Command } from '@effect/cli';
import { Effect } from 'effect';
import { Output } from '../../services/Output';

/**
 * Field schema definitions for AI reference.
 * This is a comprehensive documentation of the CreateTableCommand input schema.
 */
const fieldSchemaDoc = {
  description: 'CreateTableCommand field input schema documentation',
  fieldTypes: [
    {
      type: 'singleLineText',
      description: 'Single line text field',
      properties: {
        id: {
          type: 'string',
          optional: true,
          description: 'Field ID (auto-generated if not provided)',
        },
        name: {
          type: 'string',
          optional: true,
          description: 'Field name (auto-generated if not provided)',
        },
        isPrimary: {
          type: 'boolean',
          optional: true,
          description: 'Whether this is the primary field',
        },
        notNull: { type: 'boolean', optional: true, description: 'Require non-null value' },
        unique: { type: 'boolean', optional: true, description: 'Require unique value' },
        options: {
          type: 'object',
          optional: true,
          properties: {
            showAs: {
              type: 'object',
              optional: true,
              properties: {
                type: { type: 'enum', values: ['url', 'email', 'phone'] },
              },
            },
            defaultValue: { type: 'string', optional: true },
          },
        },
      },
      example: { type: 'singleLineText', name: 'Title', isPrimary: true },
    },
    {
      type: 'longText',
      description: 'Multi-line text field',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            defaultValue: { type: 'string', optional: true },
          },
        },
      },
      example: { type: 'longText', name: 'Description' },
    },
    {
      type: 'number',
      description: 'Numeric field',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            formatting: {
              type: 'discriminatedUnion',
              discriminator: 'type',
              variants: [
                { type: 'decimal', properties: { precision: { type: 'number', min: 0, max: 5 } } },
                { type: 'percent', properties: { precision: { type: 'number', min: 0, max: 5 } } },
                {
                  type: 'currency',
                  properties: {
                    precision: { type: 'number', min: 0, max: 5 },
                    symbol: { type: 'string' },
                  },
                },
              ],
            },
            defaultValue: { type: 'number', optional: true },
          },
        },
      },
      example: {
        type: 'number',
        name: 'Amount',
        options: { formatting: { type: 'currency', precision: 2, symbol: '$' } },
      },
    },
    {
      type: 'rating',
      description: 'Rating field (1-N stars)',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            icon: {
              type: 'enum',
              values: ['star', 'moon', 'sun', 'zap', 'flame', 'heart', 'like', 'flag'],
              optional: true,
            },
            color: {
              type: 'enum',
              values: [
                'yellow',
                'orange',
                'red',
                'pink',
                'purple',
                'blue',
                'cyan',
                'teal',
                'green',
                'gray',
              ],
              optional: true,
            },
            max: { type: 'number', optional: true, description: 'Max rating value (default: 5)' },
          },
        },
      },
      example: {
        type: 'rating',
        name: 'Priority',
        options: { max: 5, icon: 'star', color: 'yellow' },
      },
    },
    {
      type: 'singleSelect',
      description: 'Single selection from predefined options',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          required: true,
          properties: {
            choices: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', optional: true },
                  name: { type: 'string', required: true },
                  color: {
                    type: 'enum',
                    required: true,
                    values: [
                      'blueLight2',
                      'blueLight1',
                      'blueBright',
                      'blue',
                      'blueDark1',
                      'cyanLight2',
                      'cyanLight1',
                      'cyanBright',
                      'cyan',
                      'cyanDark1',
                      'grayLight2',
                      'grayLight1',
                      'grayBright',
                      'gray',
                      'grayDark1',
                      'greenLight2',
                      'greenLight1',
                      'greenBright',
                      'green',
                      'greenDark1',
                      'orangeLight2',
                      'orangeLight1',
                      'orangeBright',
                      'orange',
                      'orangeDark1',
                      'pinkLight2',
                      'pinkLight1',
                      'pinkBright',
                      'pink',
                      'pinkDark1',
                      'purpleLight2',
                      'purpleLight1',
                      'purpleBright',
                      'purple',
                      'purpleDark1',
                      'redLight2',
                      'redLight1',
                      'redBright',
                      'red',
                      'redDark1',
                      'tealLight2',
                      'tealLight1',
                      'tealBright',
                      'teal',
                      'tealDark1',
                      'yellowLight2',
                      'yellowLight1',
                      'yellowBright',
                      'yellow',
                      'yellowDark1',
                    ],
                    description: 'Color must be specified for each choice',
                  },
                },
              },
            },
            defaultValue: { type: 'string', optional: true, description: 'Default choice name' },
            preventAutoNewOptions: { type: 'boolean', optional: true },
          },
        },
      },
      example: {
        type: 'singleSelect',
        name: 'Status',
        options: {
          choices: [
            { name: 'Todo', color: 'grayLight1' },
            { name: 'In Progress', color: 'blueLight1' },
            { name: 'Done', color: 'greenLight1' },
          ],
        },
      },
    },
    {
      type: 'multipleSelect',
      description: 'Multiple selection from predefined options',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          required: true,
          properties: {
            choices: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', optional: true },
                  name: { type: 'string', required: true },
                  color: {
                    type: 'enum',
                    required: true,
                    description: 'Same as singleSelect colors',
                  },
                },
              },
            },
            defaultValue: { type: 'array', items: 'string', optional: true },
            preventAutoNewOptions: { type: 'boolean', optional: true },
          },
        },
      },
      example: {
        type: 'multipleSelect',
        name: 'Tags',
        options: {
          choices: [
            { name: 'Bug', color: 'redLight1' },
            { name: 'Feature', color: 'blueLight1' },
            { name: 'Urgent', color: 'orangeLight1' },
          ],
        },
      },
    },
    {
      type: 'checkbox',
      description: 'Boolean checkbox field',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            defaultValue: { type: 'boolean', optional: true },
          },
        },
      },
      example: { type: 'checkbox', name: 'Completed' },
    },
    {
      type: 'date',
      description: 'Date/datetime field',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            formatting: {
              type: 'object',
              optional: true,
              properties: {
                date: { type: 'string', description: 'Date format string' },
                time: { type: 'enum', values: ['24h', '12h', 'none'] },
                timeZone: {
                  type: 'string',
                  description: 'IANA timezone (e.g., "UTC", "America/New_York")',
                },
              },
            },
            defaultValue: { type: 'enum', values: ['now'], optional: true },
          },
        },
      },
      example: { type: 'date', name: 'Due Date', options: { defaultValue: 'now' } },
    },
    {
      type: 'attachment',
      description: 'File attachment field',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
      },
      example: { type: 'attachment', name: 'Files' },
    },
    {
      type: 'user',
      description: 'User reference field',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            isMultiple: { type: 'boolean', optional: true, description: 'Allow multiple users' },
            shouldNotify: { type: 'boolean', optional: true, description: 'Notify assigned users' },
          },
        },
      },
      example: {
        type: 'user',
        name: 'Assignee',
        options: { isMultiple: false, shouldNotify: true },
      },
    },
    {
      type: 'link',
      description: 'Link to another table (relationship field)',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          required: true,
          properties: {
            relationship: {
              type: 'enum',
              required: true,
              values: ['oneOne', 'oneMany', 'manyOne', 'manyMany'],
              description:
                'oneOne: 1:1, oneMany: 1:N (this table is "one" side), manyOne: N:1 (this table is "many" side), manyMany: N:N',
            },
            foreignTableId: {
              type: 'string',
              required: true,
              description: 'ID of the linked table',
            },
            lookupFieldId: {
              type: 'string',
              required: true,
              description: 'ID of the field in foreignTable to display (usually the primary field)',
            },
            baseId: {
              type: 'string',
              optional: true,
              description: 'Base ID if linking to a different base',
            },
            isOneWay: {
              type: 'boolean',
              optional: true,
              description: 'If true, no symmetric field is created in foreign table',
            },
            symmetricFieldId: {
              type: 'string',
              optional: true,
              description: 'ID of symmetric field in foreign table',
            },
            filterByViewId: {
              type: 'string',
              optional: true,
              description: 'Only show records from this view',
            },
            visibleFieldIds: {
              type: 'array',
              items: 'string',
              optional: true,
              description: 'Fields to show in link picker',
            },
          },
        },
      },
      example: {
        type: 'link',
        name: 'Company',
        options: {
          relationship: 'manyOne',
          foreignTableId: 'tblXXXXXXXX',
          lookupFieldId: 'fldYYYYYYYY',
        },
      },
      notes: [
        'To get lookupFieldId, first query the foreign table fields to find its primary field ID',
        'Use "manyOne" when this record belongs to one foreign record (e.g., Contact belongs to Company)',
        'Use "oneMany" when this record owns many foreign records (e.g., Company has many Contacts)',
      ],
    },
    {
      type: 'lookup',
      description: 'Lookup field value from linked table',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          required: true,
          properties: {
            linkFieldId: {
              type: 'string',
              required: true,
              description: 'ID of the link field in this table',
            },
            foreignTableId: {
              type: 'string',
              required: true,
              description: 'ID of the foreign table',
            },
            lookupFieldId: {
              type: 'string',
              required: true,
              description: 'ID of the field to lookup in foreign table',
            },
          },
        },
      },
      example: {
        type: 'lookup',
        name: 'Company Industry',
        options: {
          linkFieldId: 'fldLinkToCompany',
          foreignTableId: 'tblCompanies',
          lookupFieldId: 'fldIndustry',
        },
      },
    },
    {
      type: 'rollup',
      description: 'Aggregate values from linked records',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          required: true,
          properties: {
            expression: {
              type: 'string',
              required: true,
              description: 'Rollup expression (e.g., "SUM(values)", "COUNT(values)")',
            },
            timeZone: { type: 'string', optional: true },
            formatting: { type: 'object', optional: true },
          },
        },
        config: {
          type: 'object',
          required: true,
          properties: {
            linkFieldId: { type: 'string', required: true },
            foreignTableId: { type: 'string', required: true },
            lookupFieldId: { type: 'string', required: true, description: 'Field to aggregate' },
          },
        },
      },
      example: {
        type: 'rollup',
        name: 'Total Amount',
        options: { expression: 'SUM(values)' },
        config: {
          linkFieldId: 'fldDeals',
          foreignTableId: 'tblDeals',
          lookupFieldId: 'fldAmount',
        },
      },
    },
    {
      type: 'formula',
      description: 'Calculated field using formula expression',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          required: true,
          properties: {
            expression: {
              type: 'string',
              required: true,
              description: 'Formula expression (e.g., "{Amount} * 1.1")',
            },
            timeZone: { type: 'string', optional: true },
            formatting: { type: 'object', optional: true },
          },
        },
      },
      example: {
        type: 'formula',
        name: 'Tax Amount',
        options: { expression: '{Amount} * 0.1' },
      },
    },
    {
      type: 'autoNumber',
      description: 'Auto-incrementing number field',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
      },
      example: { type: 'autoNumber', name: 'ID' },
    },
    {
      type: 'createdTime',
      description: 'Automatic record creation timestamp',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            formatting: { type: 'object', optional: true, description: 'Date formatting options' },
          },
        },
      },
      example: { type: 'createdTime', name: 'Created At' },
    },
    {
      type: 'lastModifiedTime',
      description: 'Automatic record modification timestamp',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            formatting: { type: 'object', optional: true },
            trackedFieldIds: {
              type: 'array',
              items: 'string',
              optional: true,
              description: 'Only track changes to these fields',
            },
          },
        },
      },
      example: { type: 'lastModifiedTime', name: 'Updated At' },
    },
    {
      type: 'createdBy',
      description: 'Automatic record creator user reference',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
      },
      example: { type: 'createdBy', name: 'Created By' },
    },
    {
      type: 'lastModifiedBy',
      description: 'Automatic last modifier user reference',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            trackedFieldIds: { type: 'array', items: 'string', optional: true },
          },
        },
      },
      example: { type: 'lastModifiedBy', name: 'Last Modified By' },
    },
    {
      type: 'button',
      description: 'Action button field',
      properties: {
        id: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        isPrimary: { type: 'boolean', optional: true },
        notNull: { type: 'boolean', optional: true },
        unique: { type: 'boolean', optional: true },
        options: {
          type: 'object',
          optional: true,
          properties: {
            label: { type: 'string', optional: true },
            color: { type: 'enum', optional: true, description: 'Same as singleSelect colors' },
            maxCount: { type: 'number', optional: true },
            resetCount: { type: 'boolean', optional: true },
            workflow: {
              type: 'object',
              optional: true,
              properties: {
                id: { type: 'string', optional: true },
                name: { type: 'string', optional: true },
                isActive: { type: 'boolean', optional: true },
              },
            },
          },
        },
      },
      example: {
        type: 'button',
        name: 'Approve',
        options: { label: 'Approve', color: 'greenBright' },
      },
    },
  ],
  commonPatterns: {
    simpleTable: {
      description: 'A simple table with text and select fields',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Status',
          options: {
            choices: [
              { name: 'Active', color: 'greenLight1' },
              { name: 'Inactive', color: 'grayLight1' },
            ],
          },
        },
        { type: 'createdTime', name: 'Created At' },
      ],
    },
    crmCompanies: {
      description: 'Companies table for CRM',
      fields: [
        { type: 'singleLineText', name: 'Company Name', isPrimary: true },
        {
          type: 'singleSelect',
          name: 'Industry',
          options: {
            choices: [
              { name: 'Technology', color: 'blueLight1' },
              { name: 'Finance', color: 'greenLight1' },
            ],
          },
        },
        { type: 'singleLineText', name: 'Website', options: { showAs: { type: 'url' } } },
        { type: 'singleLineText', name: 'Phone', options: { showAs: { type: 'phone' } } },
        { type: 'createdTime', name: 'Created At' },
      ],
    },
    linkedTable: {
      description: 'Table with link field (requires existing foreignTableId and lookupFieldId)',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'link',
          name: 'Related Items',
          options: { relationship: 'manyOne', foreignTableId: 'tbl...', lookupFieldId: 'fld...' },
        },
      ],
      note: 'Replace foreignTableId and lookupFieldId with actual IDs from target table',
    },
  },
  importantNotes: [
    'SingleSelect/MultipleSelect choices MUST have a "color" property - this is required',
    'Link fields require foreignTableId AND lookupFieldId - query the target table first to get these',
    'The first field with isPrimary: true becomes the primary field (defaults to first field)',
    'If no fields are provided, a default "Name" primary field is created',
    'Field IDs are auto-generated if not provided (prefixed with "fld")',
    'Table IDs are auto-generated if not provided (prefixed with "tbl")',
  ],
};

const handler = () =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.success('tables.describe-schema', {}, fieldSchemaDoc);
  });

export const tablesDescribeSchema = Command.make('describe-schema', {}, handler).pipe(
  Command.withDescription('Output field schema documentation for AI reference')
);
