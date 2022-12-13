export function convertNameToValidCharacter(name: string): string {
  const matchedArray = name.match(/\w*/g);
  return matchedArray?.join('').substring(0, 10) || 'unnamed';
}
