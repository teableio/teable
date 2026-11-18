import { splitDownloadLinks } from './notification-downloads';

describe('splitDownloadLinks', () => {
  it('takes a download link out of the text', () => {
    const html =
      'Orders partially imported: 20 rows failed. <a href="https://x/report.csv" download="error_report.csv">📥 Download Error Report</a>';
    expect(splitDownloadLinks(html, { isExport: false })).toEqual({
      html: 'Orders partially imported: 20 rows failed.',
      downloads: [
        {
          url: 'https://x/report.csv',
          label: 'Download Error Report',
          fileName: 'error_report.csv',
        },
      ],
    });
  });

  it("treats an export's link as its file", () => {
    const html = 'Sales exported successfully: <a href="/f/1" name="Sales.tea">🗂️ Sales.tea</a>';
    expect(splitDownloadLinks(html, { isExport: true })).toEqual({
      html: 'Sales exported successfully:',
      downloads: [{ url: '/f/1', label: 'Sales.tea', fileName: 'Sales.tea' }],
    });
  });

  it('leaves ordinary links in the sentence', () => {
    const html = 'Your <a href="/space/1">Main space</a> reward claim has been approved.';
    expect(splitDownloadLinks(html, { isExport: false })).toEqual({ html, downloads: [] });
  });
});
