# SSA Teable — deployment bundle

Ready-to-run Compose stack for one **single-tenant** Teable instance (this fork)
plus the SSA companion services. Runs on an Oracle Cloud **Always Free** Ampere
VM, any small VPS, or a home server.

```
Internet ──▶ Caddy (TLS)  ── or ──  Cloudflare Tunnel
                │
                ▼
            teable :3000  ─────▶ teable-cache (Redis)
                │  ▲                └── local attachments volume
     HMAC events│  │assistant proxy
                ▼  │
        ssa-notify  ssa-ai ──▶ LLM endpoint
                │
                ▼
        Neon Postgres (free tier)          ← or the `localdb` profile
```

## What's in this directory

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | teable (built from this fork) + redis + notify + ai; optional Caddy / cloudflared / local Postgres |
| `.env.example` | compose-level knobs: domain, TLS mode, Redis/pg passwords |
| `teable.env.example` | app config + all secrets for the teable container |
| `ssa-notify.env.example`, `ssa-ai.env.example` | companion service config |
| `Caddyfile`, `Caddyfile.duckdns`, `caddy/` | TLS edge variants (real domain or free DuckDNS) |
| `backup.sh` | database dump + attachments archive |

The teable image is **built from this fork** (`dockers/teable/Dockerfile`) —
the upstream `ghcr.io/teableio/teable` image does not contain the SSA backend
features. Images build natively for **amd64 and arm64**.

## Quickstart (any host with Docker)

```bash
cd ssa/deploy
cp .env.example .env
cp teable.env.example teable.env
cp ssa-notify.env.example ssa-notify.env
cp ssa-ai.env.example ssa-ai.env
# edit all four files (secrets! see the generation commands inside)
docker compose --profile edge-caddy up -d --build     # or --profile edge-tunnel
```

First boot takes ~10–25 min (full monorepo image build) and needs ~8 GB RAM.
Afterwards the app is at `https://$DOMAIN`; run through the first-boot
checklist in [`docs/ssa/DEPLOY.md`](../../docs/ssa/DEPLOY.md) §3 (first account,
Personal Access Tokens for the services, notify rules/digest, assistant).

Useful commands:

```bash
docker compose ps                              # health of every service
docker compose logs -f teable ssa-notify ssa-ai
curl -s localhost:3000/health                  # app + meta database readiness
curl -s localhost:3000/api/ssa/health -H "X-SSA-Token: $SSA_INTERNAL_TOKEN"
```

## Oracle Cloud Always Free — full walkthrough

The **Ampere A1** shape (2 OCPU / 12 GB RAM ARM, 200 GB block storage, up to
10 TB egress/month) stays inside Oracle's Always Free limits when running 24/7
(1,500 OCPU-hours + 9,000 GB-hours/month). $0/month — the only optional cost
afterwards is a domain name (skip it with DuckDNS).

### 1. Create the instance

1. Sign up at <https://oracle.com/cloud/free> (card required for identity
   verification; Always Free resources are never charged). Pick a **home
   region** with Ampere capacity — it is permanent, so choose one close to
   your Neon region to keep database latency low.
2. Compute → Instances → Create:
   - Image: **Ubuntu 24.04** (aarch64)
   - Shape: **VM.Standard.A1.Flex**, 2 OCPU / 12 GB (both sliders at max for
     Always Free)
   - Boot volume: 50 GB is plenty (up to 200 GB total)
   - Networking: assign a public IPv4; upload your SSH key
3. If creation fails with "out of capacity", retry later or try another
   availability domain — capacity comes and goes.

> Keep an eye on **Billing → Budgets**: create a $0 budget so an accidentally
> created paid resource can never bill silently.

### 2. Open the firewall (skip for tunnel mode)

Two layers must allow 80/443:

- **Cloud**: VCN → Security List → add ingress rules TCP 80, 443 (`0.0.0.0/0`).
- **Instance**: Oracle's Ubuntu image ships with restrictive iptables:
  ```bash
  sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
  sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
  ```
  (Verify from outside: `curl -v http://<public-ip>`; SSH stays open.)

Tunnel mode (`--profile edge-tunnel`) needs **no** inbound ports at all — only
the security list's default SSH rule. It requires a Cloudflare-managed domain
and a tunnel token from Zero Trust → Networks → Tunnels; point the tunnel's
public hostname at `http://teable:3000` (service available on the compose
network).

### 3. Install Docker (arm64 images, native)

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
```

### 4. Clone and configure

```bash
git clone <this fork's URL> ssa-teable
cd ssa-teable && git checkout ssa/main
cd ssa/deploy
cp .env.example .env && cp teable.env.example teable.env \
  && cp ssa-notify.env.example ssa-notify.env && cp ssa-ai.env.example ssa-ai.env
```

Generate the secrets (same commands the backend's boot warning prints):

```bash
openssl rand -base64 32   # SECRET_KEY / BACKEND_JWT_SECRET / BACKEND_SESSION_SECRET / BACKEND_AI_CONFIG_ENCRYPTION_SECRET
openssl rand -hex 8       # each *_ENCRYPTION_KEY / *_ENCRYPTION_IV pair (exactly 16 chars)
openssl rand -hex 32      # SSA_INTERNAL_TOKEN / SSA_EVENTS_WEBHOOK_SECRET
```

Database: paste your **Neon** connection string into `teable.env`
(`docs/ssa/ENVIRONMENT.md` §6) — or use the local Postgres instead:
`docker compose --profile localdb ...` + the commented `PRISMA_DATABASE_URL`.

### 5. TLS — pick one $0 path

- **Own domain** (`~$10/yr`, the only possible cost): A/AAAA record → the VM's
  public IP, `DOMAIN=workspace.example.com`; keep the default
  `CADDYFILE=Caddyfile` + `CADDY_DOCKERFILE=Dockerfile.plain`.
- **No domain, $0 forever**: create a free subdomain at
  <https://duckdns.org> (yourname.duckdns.org → VM public IP), then in `.env`:
  `DOMAIN=yourname.duckdns.org`, `CADDYFILE=Caddyfile.duckdns`,
  `CADDY_DOCKERFILE=Dockerfile.duckdns`, `DUCKDNS_TOKEN=…` (DuckDNS issues the
  certificate via DNS-01; ports 80/443 can stay closed).
- **Cloudflare Tunnel** (no inbound ports): set `TUNNEL_TOKEN=…` and start with
  `--profile edge-tunnel`.

### 6. Start

```bash
docker compose --profile edge-caddy up -d --build
docker compose logs -f teable       # wait for "Nest application successfully started"
```

The container runs `prisma migrate deploy` at boot (advisory-locked — safe to
restart anytime; it never resets data) and then serves the app. Finish with
`docs/ssa/DEPLOY.md` §3 (first account → service tokens → notify rules → dry-run
digest → assistant).

### 7. Configure notify (rules + digest)

```bash
mkdir -p notify
cp ../services/notify/notify.rules.example.json  notify/notify.rules.json
cp ../services/notify/notify.digest.example.json notify/notify.digest.json
# edit ids/recipients, keep SSA_DRY_RUN=true for a day, then flip it off and:
docker compose restart ssa-notify
curl -X POST localhost:4600/digest/run -H "X-SSA-Token: <SSA_INTERNAL_TOKEN>"  # needs a temporary port publish
```

`ssa-notify` and `ssa-ai` are internal-only (no published ports) — reach them
via `docker compose exec ssa-notify node -e "fetch('http://127.0.0.1:4600/healthz').then(r=>r.text()).then(console.log)"`
or temporarily publish a port in a `docker-compose.override.yml`.

## Backups

```bash
cd ssa/deploy && ./backup.sh          # → backups/<timestamp>/{db.sql,attachments.tgz}
```

- **Neon** also keeps point-in-time restore on free branches — use both.
- Restore: `docker run --rm -i postgres:15.4 psql "$PRISMA_DATABASE_URL" < db.sql`
  (for `localdb`: `docker compose exec -T teable-db psql -U teable -d teable < db.sql`),
  and unpack `attachments.tgz` back into the `teable-data` volume.
- Schedule it: `crontab -e` → `17 3 * * * cd /home/ubuntu/ssa-teable/ssa/deploy && bash backup.sh >> backups/cron.log 2>&1`
  (then copy `backups/` off the VM — e.g. `scp`, or `rclone` to any free object storage).

## Upgrades

```bash
cd ssa-teable && git pull            # ssa/main
cd ssa/deploy && docker compose --profile edge-caddy up -d --build
```

Migrations run automatically at boot against the external database; Redis is
disposable; attachments live in the `teable-data` volume. Nothing else needs
preserving — see `docs/ssa/DEPLOY.md` §5 for the full persistence FAQ.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `health: starting` for a long time on first boot | Migrations + NEON cold start; watch `docker compose logs teable`. Allow up to `start_period: 300s`. |
| First request after idle is slow (~1 s) | Neon free scales to zero and wakes on connect — expected. |
| Caddy issues a certificate for the wrong name / fails | `.env` `DOMAIN` must be the full public hostname and DNS must already point at the VM; check `docker compose logs caddy`. |
| `notify` says "SSA_EVENTS_WEBHOOK_SECRET unset" | Secrets differ between `teable.env` and `ssa-notify.env` — they must match. |
| ARM VM build fails in a native module | All images here are multi-arch and build natively on Ampere; if you switch to a prebuilt image, check it publishes `linux/arm64`. |
| Disk filling up | `docker system df`; old images/build cache: `docker builder prune`. The app needs < 10 GB including images. |

Security baseline: only 22 (+80/443 for Caddy) open, everything else on the
compose network; `SSA_SINGLE_TENANT=true`; secrets only in the git-ignored
`*.env` files; consider `fail2ban` + unattended-upgrades on the host.
