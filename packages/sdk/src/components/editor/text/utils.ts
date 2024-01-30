import { SingleLineTextDisplayType } from '@teable/core';

export const onMixedTextClick = (type: SingleLineTextDisplayType, text: string) => {
  let url = '';

  if (type === SingleLineTextDisplayType.Url) {
    try {
      const testURL = new URL(text);
      if (testURL.protocol && !/^javascript:/i.test(testURL.protocol)) {
        url = testURL.href;
      }
    } catch (error) {
      try {
        const testURL = new URL(`http://${text}`);
        url = testURL.href;
      } catch (error) {
        console.log(error);
      }
    }
  } else if (type === SingleLineTextDisplayType.Email) {
    url = `mailto:${text}`;
  } else if (type === SingleLineTextDisplayType.Phone) {
    url = `tel:${text}`;
  }

  if (!url) return;

  const newWindow = window.open(url, '_blank', 'noopener=yes,noreferrer=yes');
  newWindow && (newWindow.opener = null);
};
