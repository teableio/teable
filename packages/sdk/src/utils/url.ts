const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

// Resolves free text to an absolute href, prefixing http:// when the text has
// no scheme (www.teable.io, google.com). Returns '' for unsafe input.
export const toUrlHref = (text: string) => {
  const url = parseUrl(text) ?? parseUrl(`http://${text}`);
  return !url || /^javascript:/i.test(url.protocol) ? '' : url.href;
};

export const openInNewTab = (url: string) => {
  const newWindow = window.open(url, '_blank', 'noopener=yes,noreferrer=yes');
  newWindow && (newWindow.opener = null);
};

export const openUrl = (text: string) => {
  const url = toUrlHref(text);
  if (url) openInNewTab(url);
};
