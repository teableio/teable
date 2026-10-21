export const readBoolEnv = (name: string): boolean => {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
};

export const readPositiveIntEnv = (name: string, defaultValue: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue;
};

/** like readPositiveIntEnv but 0 is a valid value (used for "disabled") */
export const readNonNegativeIntEnv = (name: string, defaultValue: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : defaultValue;
};
