import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';

/**
 * 通过 access token 自动登录页面
 * 这个页面接收 access token，然后通过 API 创建 session cookie，实现自动登录
 *
 * 使用方式：
 * /auth/auto-login?access_token=xxx&redirect=/space
 */
const AutoLoginPage = () => {
  const router = useRouter();
  const { access_token, redirect } = router.query;
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!access_token) {
      router.push('/auth/login');
      return;
    }

    // 通过 access token 调用 API 获取用户信息
    // 这会在服务端创建 session cookie
    fetch('/api/auth/auto-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      credentials: 'include',
    })
      .then(async (response) => {
        if (response.ok) {
          // 解析用户信息，获取用户配置的语言
          const userData = await response.json();
          const userLang = userData?.lang;

          // 如果用户有设置语言，则设置 cookie 并切换 i18n 语言
          if (userLang) {
            // 设置 NEXT_LOCALE cookie
            document.cookie = `NEXT_LOCALE=${userLang}; max-age=31536000; path=/`;
            // 切换 i18n 语言
            i18n.changeLanguage(userLang);
          } else {
            // 如果用户没有设置语言，清除 cookie（使用浏览器默认语言）
            document.cookie = `NEXT_LOCALE=; max-age=0; path=/`;
          }

          // 登录成功，跳转到指定页面
          const redirectPath = typeof redirect === 'string' ? redirect : '/space';
          router.push(redirectPath);
        } else {
          // 登录失败，跳转到登录页面
          router.push('/auth/login');
        }
      })
      .catch((error) => {
        console.error('自动登录失败:', error);
        router.push('/auth/login');
      });
  }, [access_token, redirect, router, i18n]);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'white',
      }}
    >
      <div style={{ textAlign: 'center', color: '#333' }}>
        <div
          style={{
            border: '4px solid rgba(0, 0, 0, 0.1)',
            borderTop: '4px solid #667eea',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px',
          }}
        ></div>
        <p>正在自动登录...</p>
      </div>
      {/* eslint-disable react/no-unknown-property */}
      <style jsx>{`
        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};

export const getServerSideProps: GetServerSideProps = async () => {
  // 这个页面不需要服务端验证，因为我们要通过 access token 登录
  return {
    props: {},
  };
};

export default AutoLoginPage;
