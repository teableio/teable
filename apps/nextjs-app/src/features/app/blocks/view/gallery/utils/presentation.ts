export type PresentationAction = 'next' | 'prev' | 'exit';

export interface IPresentationRecordWindow {
  skip: number;
  take: number;
  offset: number;
}

export const clampIndex = (index: number, count: number): number => {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
};

export const stepIndex = (index: number, count: number, delta: number): number => {
  return clampIndex(index + delta, count);
};

export const getRecordWindow = (index: number): IPresentationRecordWindow => {
  const skip = Math.max(0, index - 1);
  return {
    skip,
    take: 3,
    offset: index === 0 ? 0 : 1,
  };
};

export const resolvePresentationKey = (event: { key: string }): PresentationAction | null => {
  switch (event.key) {
    case 'ArrowRight':
    case 'j':
    case 'J':
      return 'next';
    case 'ArrowLeft':
    case 'k':
    case 'K':
      return 'prev';
    case 'Escape':
      return 'exit';
    default:
      return null;
  }
};

export const shouldIgnorePresentationHotkey = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (
    target.isContentEditable ||
    target.contentEditable === 'true' ||
    target.getAttribute('contenteditable')?.toLowerCase() === 'true'
  );
};
