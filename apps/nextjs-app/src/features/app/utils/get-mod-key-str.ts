export function getModKeyStr() {
  if (typeof navigator !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const platform = navigator.platform || (navigator as any).userAgentData?.platform || '';
    return /^Mac/i.test(platform) ? '⌘' : 'Ctrl';
  }
  return 'Ctrl';
}
