export function convertNameToValidCharacter(name: string, maxLength = 10): string {
  const matchedArray = name.match(/\w*/g);
  return matchedArray?.join('').substring(0, maxLength) || 'unnamed';
}
