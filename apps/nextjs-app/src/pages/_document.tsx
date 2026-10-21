import { isRtlLang } from '@teable/sdk/utils';
import type { DocumentContext, DocumentProps } from 'next/document';
import Document, { Html, Main, Head, NextScript } from 'next/document';
import { CookieLocaleKey } from '@/lib/i18n/getTranslationsProps';

type Props = DocumentProps & {
  emotionStyleTags?: string[];
  serverLocale?: string;
  rtlUi?: boolean;
};

class MyDocument extends Document<Props> {
  // This app does not use Next's built-in i18n routing, so `props.locale` is
  // always undefined here. The language is resolved by the proxy and handed on
  // through the `X-Server-Locale` response header — the same source
  // `getTranslationsProps` reads.
  static async getInitialProps(ctx: DocumentContext) {
    const initialProps = await Document.getInitialProps(ctx);
    const serverLocale = ctx.res?.getHeader(CookieLocaleKey) as string | undefined;
    // Mirroring ships on, with ENABLE_RTL_UI=false as the way to take it back
    // out without reverting or redeploying: setting it returns RTL locales to
    // the unmirrored interface they had before, which stays perfectly usable.
    // Text the user types follows the document, so it reverts with the switch
    // too. What outlives it is the direction of *displayed* content: canvas
    // cells and record values each carry their own and stay readable either way.
    const rtlUi = process.env.ENABLE_RTL_UI !== 'false' && isRtlLang(serverLocale);
    return { ...initialProps, serverLocale, rtlUi };
  }

  render() {
    const { serverLocale, rtlUi } = this.props;

    return (
      // Both attributes are gated together, so with the switch off the markup is
      // exactly what it was: `dir` was never set ('ltr' is the browser default
      // anyway) and neither was `lang`, since `props.locale` is always undefined
      // without Next's i18n routing. Turning `lang` on for every locale is worth
      // doing on its own — it is an accessibility fix — but it also feeds CJK
      // glyph selection, so it does not belong in a change that promises to
      // leave other locales untouched.
      // The canvas grid opts back out of `dir` with its own dir="ltr".
      <Html lang={rtlUi ? serverLocale : this.props.locale} dir={rtlUi ? 'rtl' : undefined}>
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
            type="image/svg+xml"
            sizes="any"
            href="/images/favicon/favicon-light.svg"
            media="(prefers-color-scheme: light)"
          />
          <link
            rel="icon"
            type="image/svg+xml"
            sizes="any"
            href="/images/favicon/favicon-dark.svg"
            media="(prefers-color-scheme: dark)"
          />
          <link rel="manifest" href="/images/favicon/site.webmanifest" />
          <link rel="mask-icon" href="/images/favicon/safari-pinned-tab.svg" color="#5bbad5" />
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
