export const isImage = (mimetype: string) => {
  return mimetype.startsWith('image/');
};

// HEVC-encoded stills (typically iPhone photos). Browsers other than Safari
// cannot render them, so previews should prefer the server-generated PNG thumb.
export const isHeic = (mimetype: string) => {
  return ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'].includes(
    mimetype
  );
};
export const isVideo = (mimetype: string) => {
  return mimetype.startsWith('video/');
};

export const isAudio = (mimetype: string) => {
  return mimetype.startsWith('audio/');
};

export const isText = (mimetype: string) => {
  return mimetype.startsWith('text/');
};

/**
 * Mime types we render via the text preview path. Restricted to `text/*` plus
 * a small allowlist of structured-text `application/*` types whose body is
 * UTF-8 source code. Binaries dressed up as text would fetch fine but render
 * as garbage — the allowlist keeps that surface area small.
 */
const textLikeApplicationMimes = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/yaml',
  'application/x-yaml',
]);

export const isTextLike = (mimetype: string) => {
  return mimetype.startsWith('text/') || textLikeApplicationMimes.has(mimetype);
};

export const isHtml = (mimetype: string) => mimetype.startsWith('text/html');

const pdfMimetypes = new Set(['application/pdf', 'application/x-pdf']);

/**
 * Exact media type, parameters aside: a prefix match would also take
 * `application/pdf+xml` or `application/pdf,text/html`, which the browser does
 * not render as a PDF.
 */
export const isPdf = (mimetype: string) => {
  return pdfMimetypes.has(mimetype.split(';')[0].trim().toLowerCase());
};

/**
 * A blob keeps the Content-Type its response came with, and a blob URL created
 * here opens on the app origin. Retype it so the frame can only ever load the
 * PDF viewer, never a document that runs scripts with the viewer's session.
 */
export const toPdfBlob = (blob: Blob) => blob.slice(0, blob.size, 'application/pdf');

const safeLinkProtocols = new Set(['http:', 'https:', 'mailto:']);

/**
 * Documents rendered into the app's own DOM (docx-preview) keep the hyperlink
 * targets of the file as they are, so a `javascript:` link would run on click.
 * Drop every href that is not a web or mail link; in-document anchors stay.
 */
export const sanitizePreviewLinks = (container: HTMLElement) => {
  container.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      return;
    }
    let protocol = '';
    try {
      protocol = new URL(href, window.location.href).protocol;
    } catch {
      protocol = '';
    }
    if (!safeLinkProtocols.has(protocol)) {
      anchor.removeAttribute('href');
      return;
    }
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });
};

export const isWord = (mimetype: string) => {
  return (
    mimetype.startsWith('application/msword') ||
    mimetype.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  );
};

export const isExcel = (mimetype: string) => {
  return (
    mimetype.startsWith('application/vnd.ms-excel') ||
    mimetype.startsWith('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
    mimetype.startsWith('text/csv') ||
    mimetype.startsWith('application/csv')
  );
};

export const isPpt = (mimetype: string) => {
  return (
    mimetype.startsWith('application/vnd.ms-powerpoint') ||
    mimetype.startsWith('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  );
};

export const isMarkdown = (mimetype: string) => {
  return mimetype.startsWith('text/markdown');
};

export const isPackage = (mimetype: string) => {
  return mimetype.startsWith('application/zip');
};
