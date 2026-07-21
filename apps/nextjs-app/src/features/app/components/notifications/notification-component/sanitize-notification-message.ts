import DOMPurify from 'dompurify';

/**
 * Sanitize notification message HTML before it is injected via
 * dangerouslySetInnerHTML.
 *
 * Notification messages legitimately contain a small amount of markup produced
 * by our own i18n templates (download / preview links, <b> counts). The actor
 * display name (fromUserName), however, is interpolated into those templates
 * verbatim and is fully attacker-controlled, so the assembled string must be
 * sanitized before rendering — otherwise a display name like
 * `<img src=x onerror=...>` executes in the recipient's session (stored XSS).
 *
 * We allow only the tags/attributes our templates actually use and strip every
 * event-handler attribute and unknown tag. URI safety is left to DOMPurify's
 * default policy, which blocks `javascript:` / `data:` hrefs while preserving
 * the relative preview/download URLs that local-storage exports produce.
 */
const ALLOWED_TAGS = ['a', 'b', 'strong', 'em', 'i', 'span', 'br'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'download', 'name', 'class', 'style'];

export const sanitizeNotificationMessage = (message: string): string =>
  DOMPurify.sanitize(message, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });
