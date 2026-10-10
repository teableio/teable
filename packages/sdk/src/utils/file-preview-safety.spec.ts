import { isPdf, sanitizePreviewLinks, toPdfBlob } from '@teable/ui-lib';

// ui-lib has no test runner of its own; these cover its file preview helpers.
describe('file preview safety', () => {
  it('only treats an exact pdf media type as pdf', () => {
    expect(isPdf('application/pdf')).toBe(true);
    expect(isPdf('Application/PDF; charset=binary')).toBe(true);
    expect(isPdf('application/x-pdf')).toBe(true);
    expect(isPdf('application/pdf+xml')).toBe(false);
    expect(isPdf('application/pdf,text/html')).toBe(false);
    expect(isPdf('text/html')).toBe(false);
  });

  it('retypes the fetched blob as pdf whatever the response said', () => {
    const blob = toPdfBlob(new Blob(['<html></html>'], { type: 'text/html' }));
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(13);
  });

  it('keeps web, mail and in-document links and drops the rest', () => {
    const container = document.createElement('div');
    container.innerHTML = [
      '<a href="https://example.com/a">web</a>',
      '<a href="mailto:a@example.com">mail</a>',
      '<a href="#bookmark">anchor</a>',
      '<a href="javascript:alert(1)">script</a>',
      '<a href=" JavaScript:alert(1)">spaced</a>',
      '<a href="data:text/html,hi">data</a>',
    ].join('');

    sanitizePreviewLinks(container);

    const anchors = Array.from(container.querySelectorAll('a'));
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/a',
      'mailto:a@example.com',
      '#bookmark',
      null,
      null,
      null,
    ]);
    expect(anchors[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchors[0].getAttribute('target')).toBe('_blank');
  });
});
