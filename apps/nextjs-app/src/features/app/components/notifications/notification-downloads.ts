/**
 * Download links some message templates carry inline (an import's error
 * report, an export's file). The message is clamped to two lines, which can
 * cut such a link off, so they come out of the text and show as buttons below
 * it. Other links (a space, the terms of service) stay in the sentence.
 */

export interface INotificationDownload {
  url: string;
  /** The link's own words, without the emoji the templates open with. */
  label: string;
  fileName: string;
}

const LEADING_EMOJI = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u;

export const splitDownloadLinks = (
  html: string,
  options: { isExport: boolean }
): { html: string; downloads: INotificationDownload[] } => {
  if (typeof DOMParser === 'undefined' || !html.includes('<a')) return { html, downloads: [] };

  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body
    .firstElementChild as HTMLElement;
  const downloads: INotificationDownload[] = [];
  root.querySelectorAll('a').forEach((anchor) => {
    // An export's only link is its file; elsewhere a download says so itself.
    if (!options.isExport && !anchor.hasAttribute('download')) return;
    const label = (anchor.textContent ?? '').replace(LEADING_EMOJI, '').trim();
    downloads.push({
      url: anchor.getAttribute('href') ?? '',
      label,
      fileName: anchor.getAttribute('download') || anchor.getAttribute('name') || label,
    });
    anchor.remove();
  });
  return { html: root.innerHTML.trim(), downloads };
};
