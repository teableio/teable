import type { DocumentProps } from 'next/document';
import Document, { Html, Main, Head, NextScript } from 'next/document';

type Props = DocumentProps & {
  emotionStyleTags?: string[];
};

class MyDocument extends Document<Props> {
  render() {
    const locale = this.props.locale;

    return (
      <Html lang={locale}>
        <Head>
          <meta charSet="utf-8" />
          <link
            rel="apple-touch-icon"
            sizes="180x180"
            href="/images/favicon/apple-touch-icon.png"
          />
          <link
            rel="icon"
            type="image/png"
            sizes="32x32"
            href="/images/favicon/favicon-32x32.png"
          />
          <link
            rel="icon"
            type="image/png"
            sizes="16x16"
            href="/images/favicon/favicon-16x16.png"
          />
          <link rel="manifest" href="/images/favicon/site.webmanifest" />
          <link rel="mask-icon" href="/images/favicon/safari-pinned-tab.svg" color="#5bbad5" />
          <link rel="shortcut icon" href="/images/favicon/favicon.svg" type="image/svg+xml" />
          <meta name="msapplication-TileColor" content="#da532c" />
          <meta name="msapplication-config" content="/images/favicon/browserconfig.xml" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

// Example to process graceful shutdowns (ie: closing db or other resources)
// https://nextjs.org/docs/deployment#manual-graceful-shutdowns
if (process.env.NEXT_MANUAL_SIG_HANDLE) {
  // this should be added in your custom _document
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM: ', 'cleaning up');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('Received SIGINT: ', 'cleaning up');
    process.exit(0);
  });
}

export default MyDocument;
