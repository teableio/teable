export const TQL_README = `
# Teable Query Language

Teable Query Language is a specialized language used for data querying in the Teable project. It allows you to filter and retrieve data based on specific conditions and logic.

## What is Teable Query Language?

Teable Query Language is a simple yet powerful language that enables you to create complex query conditions to meet your data querying needs. With Teable Query Language, you can easily specify fields, operators, and values to define query criteria.

## Syntax and Usage

Teable Query Language supports the following syntax and usage:

### Field Querying

You can use \`{field}\` to represent the field you want to query. For example, \`{name}\` represents a field named "name".

### Operators

Teable Query Language supports the following operators:

- \`=\`: Equality operator used to compare fields and values for equality.
- \`<\`: Less than operator used to compare if a field is less than a given value.
- \`>\`: Greater than operator used to compare if a field is greater than a given value.
- \`<=\`: Less than or equal to operator used to compare if a field is less than or equal to a given value.
- \`>=\`: Greater than or equal to operator used to compare if a field is greater than or equal to a given value.
- \`!=\`: Not equal to operator used to compare if a field and value are not equal.
- \`BETWEEN\`: This operator is used to filter fields that fall within a certain range. It requires two values to define the range.
- \`LIKE\`: This operator is used for pattern matching. It's typically used with wildcards (%) to search for a specified pattern in a field.
- \`IN\`: This operator is used to filter fields against multiple possible values. It requires a list of comma-separated values.

### Examples

Here are some examples of Teable Query Language:

- \`{status} = 'Completed'\`: Queries data where the status is "Completed".
- \`{priority} > 5\`: Queries data where the priority is greater than 5.
- \`{category} != 'Personal'\`: Queries data where the category is not "Personal".
- \`{age} BETWEEN 20 AND 30\`: Queries data where the age is between 20 and 30.
- \`{name} LIKE 'John%'\`: Queries data where the name starts with "John".
- \`{status} IN ('Completed', 'In Progress')\`: Queries data where the status is either "Completed" or "In Progress".
`;
