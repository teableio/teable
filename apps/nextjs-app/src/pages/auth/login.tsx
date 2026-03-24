import type { DehydratedState } from '@tanstack/react-query';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { SsrApi } from '@/backend/api/rest/ssr-api';
import { authConfig } from '@/features/i18n/auth.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

type Props = {
  /** Add props here */
};

export default function LoginRoute(
  props: InferGetServerSidePropsType<typeof getServerSideProps> & {
    dehydratedState: DehydratedState;
  }
) {
  const router = useRouter();
  const started = useRef(false);
  const [statusText, setStatusText] = useState<string>('正在跳转到认证中心...');

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // 记录 redirect 供 callback 使用
    const redirect = (router.query.redirect as string) || '';
    if (typeof window !== 'undefined') {
      localStorage.setItem('oauth2_redirect', redirect);
    }

    const state = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const redirectUrl = `${window.location.origin}/auth/callback`;

    // 走同源后端：/api/oauth2/initiate -> location -> 跳认证中心
    const params = new URLSearchParams({ state, redirect_url: redirectUrl });
    fetch(`/api/oauth2/initiate?${params.toString()}`, { method: 'GET', credentials: 'include' })
      .then((r) => r.json())
      .then((json) => {
        const location = json?.data?.location;
        if (location) {
          setStatusText('正在打开认证中心...');
          window.location.href = location;
        } else {
          // fallback：展示原登录页（可能包含社交登录/旧表单）
          setStatusText('初始化失败，请刷新重试');
        }
      })
      .catch(() => {
        // fallback：展示原登录页
        setStatusText('初始化失败，请检查网络后重试');
      });
  }, [router.query.redirect]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-muted-foreground/30 border-t-primary" />
        <div className="text-sm text-muted-foreground">{statusText}</div>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = withEnv(
  ensureLogin(async (context) => {
    const { i18nNamespaces } = authConfig;
    const queryClient = new QueryClient();
    const ssrApi = new SsrApi();
    await Promise.all([
      queryClient.fetchQuery({
        queryKey: ReactQueryKeys.getPublicSetting(),
        queryFn: () => ssrApi.getPublicSetting(),
      }),
    ]);
    return {
      props: {
        ...(await getTranslationsProps(context, i18nNamespaces)),
        dehydratedState: dehydrate(queryClient),
      },
    };
  }, true)
);
