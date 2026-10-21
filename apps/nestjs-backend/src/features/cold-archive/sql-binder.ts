/**
 * Positional binds for the hand-built keyset SQL the cold flushers run through
 * knex.raw. Two invariants the call sites cannot express on their own:
 *
 * - binds are consumed left-to-right, so callers must emit them in SQL order;
 * - node-postgres binds a JS Date in the PROCESS timezone, so a timestamp goes
 *   in as a UTC naive string — otherwise the predicate window shifts with the
 *   deployment TZ.
 */
export const createPositionalBinder = () => {
  const bindings: unknown[] = [];
  const bind = (value: unknown) => {
    bindings.push(value);
    return '?';
  };
  const bindTs = (value: Date) => `${bind(value.toISOString().slice(0, -1))}::timestamp`;
  return { bindings, bind, bindTs };
};
