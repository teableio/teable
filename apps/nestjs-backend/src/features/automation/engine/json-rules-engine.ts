import dayjs from 'dayjs';
import { Engine } from 'json-rules-engine';

const baseEngine = new Engine([], { allowUndefinedFacts: true });

/*
 * `always` executed, conditions, operator variables
 */
baseEngine.addOperator('always', () => {
  return true;
});

baseEngine.addFact<{ [key: string]: unknown }>('__system__', () => {
  return {
    execution_time: dayjs().format('YYYY-MM-DD HH:mm:ss'),
  };
});

export default (): Engine => baseEngine;
