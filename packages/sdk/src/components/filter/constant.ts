const EMPTYOPERATORS = ['isEmpty', 'isNotEmpty'];
const MULPTIPLEOPERATORS = ['isAnyOf', 'isNoneOf'];

const operatorLabelMapping = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  doesNotContain: 'does not contain...',
  isGreater: 'is greater than',
  isGreaterEqual: 'is greater Equal',
  isLess: 'is less than',
  isLessEqual: 'is less Equal',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  isAnyOf: 'is any of',
  isNoneOf: 'is not any of',
  hasAnyOf: 'has any of',
  hasAllOf: 'has all of',
  hasNoneOf: 'has none of',
  isExactly: 'is exactly',
  isWithIn: 'is with in',
  isBefore: 'is before',
  isAfter: 'is after',
  isOnOrBefore: 'is on or before',
  isOnOrAfter: 'is on or after',
};

const fieldNumberLabelMap = {
  is: '=',
  isNot: '≠',
  isGreater: '>',
  isGreaterEqual: '≥',
  isLess: '<',
  isLessEqual: '≤',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
};

export { EMPTYOPERATORS, MULPTIPLEOPERATORS, operatorLabelMapping, fieldNumberLabelMap };
