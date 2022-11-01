import { withEmotionCache } from '@emotion/react';
import styled from '@emotion/styled';
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useCatch,
} from '@remix-run/react';
import type { MetaFunction } from '@remix-run/react/dist/routeModules';
import { useContext, useEffect } from 'react';
import { NotFoundPage } from '@/features/system/pages';
import {
  EmotionStyleClientContext,
  EmotionStyleServerContext,
} from '@/lib/emotion';

// eslint-disable-next-line import/no-unresolved, @typescript-eslint/no-unused-vars
import tailwind from './tailwind.css';

const Container = styled('div')`
  background-color: #ff0000;
  padding: 1em;
`;

export const meta: MetaFunction = () => {
  return { title: 'Remix with Emotion' };
};

interface DocumentProps {
  children: React.ReactNode;
  title?: string;
}

type HackEmotionTypeToAllowAccessToPrivate = {
  _insertTag: (tag: HTMLStyleElement) => void;
};

const Document = withEmotionCache(
  ({ children, title }: DocumentProps, emotionCache) => {
    const serverStyleData = useContext(EmotionStyleServerContext);
    const clientStyleData = useContext(EmotionStyleClientContext);

    // Only executed on client
    useEffect(() => {
      // re-link sheet container
      emotionCache.sheet.container = document.head;

      // re-inject tags
      const tags = emotionCache.sheet.tags;
      emotionCache.sheet.flush();
      tags.forEach((tag) => {
        (
          emotionCache.sheet as unknown as HackEmotionTypeToAllowAccessToPrivate
        )._insertTag(tag);
      });

      // reset cache to re-apply global styles
      clientStyleData.reset();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          {title ? <title>{title}</title> : null}
          <Meta />
          <Links />
          {serverStyleData?.map(({ key, ids, css }) => (
            <style
              key={key}
              data-emotion={`${key} ${ids.join(' ')}`}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: css }}
            />
          ))}
        </head>
        <body>
          {children}
          <ScrollRestoration />
          <Scripts />
          {process.env.NODE_ENV === 'development' && <LiveReload />}
        </body>
      </html>
    );
  }
);

export default function App() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

export function CatchBoundary() {
  const { status, statusText } = useCatch();

  const Content = () =>
    status === 404 ? (
      <NotFoundPage />
    ) : (
      <Container>
        <p>
          [CatchBoundary]: {status} {statusText}
        </p>
      </Container>
    );
  return (
    <Document title={`${status} ${statusText}`}>
      <Content />
    </Document>
  );
}

export function ErrorBoundary({ error }: { error: Error }) {
  return (
    <Document title="Error!">
      <Container>
        <p>[ErrorBoundary]: There was an error: {error.message}</p>
      </Container>
    </Document>
  );
}
