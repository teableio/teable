import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';

/**
 * OAuth2 回调页：
 * - 从 query 读取 code/state
 * - 调用后端 /api/oauth2/callback 完成 token 兑换 + 后端建立 session cookie
 * - 再调用 /api/auth/me 获取用户语言等信息，最后跳转回原页面
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { code, state } = router.query;
  const [error, setError] = useState<string>();
  const started = useRef(false);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (started.current) return;
    if (typeof code !== 'string' || typeof state !== 'string') return;
    started.current = true;

    const redirect =
      (typeof window !== 'undefined' && localStorage.getItem('oauth2_redirect')) || '';
    const redirectPath = redirect || '/space';
    const redirectUrl = `${window.location.origin}/auth/callback`;

    (async () => {
      try {
        const params = new URLSearchParams({
          code,
          state,
          redirect_url: redirectUrl,
        });
        const resp = await fetch(`/api/oauth2/callback?${params.toString()}`, {
          method: 'GET',
          credentials: 'include',
        });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || `callback failed: ${resp.status}`);
        }

        // 读取用户信息（主要为了 lang），并设置 NEXT_LOCALE
        const meResp = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
        });
        if (meResp.ok) {
          const me = (await meResp.json()) as { user?: { lang?: string } };
          const finalLang = me?.user?.lang || 'zh';
          // 后端 callback 已经 set-cookie，这里再主动切换前端语言，避免首次落地菜单出现英文
          await i18n.changeLanguage(finalLang);
        }

        localStorage.removeItem('oauth2_redirect');
        router.replace(redirectPath);
      } catch (e) {
        setError(e instanceof Error ? e.message : '认证回调失败');
      }
    })();
  }, [code, state, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <div className="text-xl font-semibold">认证失败</div>
          <div className="mt-2 text-sm text-muted-foreground">{error}</div>
          <button
            className="mt-6 rounded bg-primary px-4 py-2 text-primary-foreground"
            onClick={() => router.replace('/auth/login')}
          >
            返回登录页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="text-center text-sm text-muted-foreground">正在处理认证...</div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async () => ({ props: {} });
