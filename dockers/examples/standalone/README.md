# Example with teable standalone

> Standalone runs the Teable core: tables, collaboration, API and automation.
> For the AI features (chat, App Builder, sandboxes) use the
> [full-featured self-host deployment](https://github.com/teableio/teable-deployment) --
> and if you are already running standalone, your data stays in place when
> [upgrading](https://github.com/teableio/teable-deployment/blob/main/migration/2026-07-basic-to-full-featured.md).

Look into the `.env` file and update the vaiables before executing `docker compose up -d`.

## Teable

- Accessible via `http://127.0.0.1:3000`
- Uses postgres db for storage
- Telemetry is disabled

## External OAuth2（认证中心）对接所需环境变量（如果启用本方案）

> 本方案会在 teable 后端提供同源接口：`/api/oauth2/*` 与 `/api/auth/me`，并在 OAuth2 回调时为用户创建/绑定 teable 本地账号并建立 session cookie。
> 因此需要 Redis 缓存来存储 `state`/`code_verifier`/token（多副本部署时必须用 Redis）。

在 `.env` 里至少需要补充：

```env
# OAuth2 provider（认证中心）
OAUTH2_CLIENT_ID=xxx
OAUTH2_CLIENT_SECRET=xxx
OAUTH2_AUTH_URL=http://edms-api:8001/v1/oauth2/login   # 实际以你们认证中心“授权入口页”URL 为准
OAUTH2_TOKEN_URL=http://edms-api:8001/v1/oauth2/oauth/token
OAUTH2_TEST_URL=http://edms-api:8001/v1/oauth2/test
OAUTH2_SCOPE=openid profile email
OAUTH2_REDIRECT_URI=https://your-domain.example.com/auth/callback  # （可选兜底）前端未传 redirect_url 时使用

# 后端缓存（用于 OAuth2 state/token 缓存）
BACKEND_CACHE_PROVIDER=redis
BACKEND_CACHE_REDIS_URI=redis://default:${REDIS_PASSWORD}@teable-cache:6379/0
```

注意：
- `OAUTH2_AUTH_URL` 需要是认证中心可访问的“授权/登录入口 URL”（最终会被拼上 `client_id/redirect_uri/state/code_challenge...`）
- 如果你们在 Docker 集群/网关场景下部署，请确保外部访问域名与回调路径 `/auth/callback` 能正确到达 teable
