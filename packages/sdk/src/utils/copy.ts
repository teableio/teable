import copy from 'copy-to-clipboard';

// you can only use this in sync keyboard or mouse click event
export const syncCopy = async (text: string) => {
  copy(text);
};
