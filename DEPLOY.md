# Deploy — Nhật Ký Trade

Production deploy on a fresh **Ubuntu 24.04 KVM VPS** (Vietnix/Hostinger/…) with
Docker, domain **nhatkytrade.com** behind **Cloudflare**.

The app + MySQL bind `127.0.0.1` only. A **Caddy** container terminates HTTPS on
443 and proxies to `app:3000`. Migrations apply automatically on container start
(`docker/entrypoint.sh` → `prisma migrate deploy`).

---

## 0. Before you touch the VPS

- [ ] **Push the code** to GitHub (`origin`) — the VPS clones from there.
- [ ] Buy the VPS + point the domain's nameservers at **Cloudflare**.
- [ ] Create a **production Google OAuth client** (below).
- [ ] Have the **Telegram bot token** ready (already in dev `.env`).

## 1. Cloudflare (DNS + TLS)

1. Add the site to Cloudflare, switch the domain's nameservers to CF's.
2. **DNS** → add an `A` record: `nhatkytrade.com` → **VPS IP**, **Proxied** (orange cloud). (Optional `www` CNAME → `nhatkytrade.com`, proxied.)
3. **SSL/TLS → Overview** → set mode **Full (strict)**. Enable **Always Use HTTPS** and **Minimum TLS 1.2**.
4. **SSL/TLS → Origin Server → Create Certificate** (15-year). Copy the two blocks to the VPS later as:
   - `docker/cf-origin/origin.pem` (certificate)
   - `docker/cf-origin/origin.key` (private key)

## 2. Google OAuth (production client)

Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 **Web** client (or create a new one):
- **Authorized JavaScript origins:** `https://nhatkytrade.com`
- **Authorized redirect URI:** `https://nhatkytrade.com/api/auth/callback/google`

Copy the **Client ID** and **Client secret** into `.env` (step 5). Login is Google-only and **fails closed** — if this is wrong, nobody can log in.

## 3. VPS — install Docker

```bash
ssh root@<VPS_IP>
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
docker compose version   # confirm the compose plugin exists
```

Cheapest 4GB VPS: add 2GB swap so the Next.js build never OOMs:
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Get the code + the origin cert

```bash
git clone git@github.com:TrungHai0230396/trading.git /opt/nhatkytrade
cd /opt/nhatkytrade
mkdir -p docker/cf-origin
nano docker/cf-origin/origin.pem   # paste the CF Origin certificate
nano docker/cf-origin/origin.key   # paste the CF Origin private key
chmod 600 docker/cf-origin/origin.key
```

## 5. Create the production `.env`

```bash
cp .env.example .env
nano .env
```

Fill these (generate secrets on the box):

```bash
openssl rand -base64 32   # → AUTH_SECRET
openssl rand -hex 32      # → ENCRYPTION_KEY   (PERMANENT — see warning)
openssl rand -hex 24      # → MYSQL_ROOT_PASSWORD
openssl rand -hex 24      # → MYSQL_PASSWORD
```

`.env` values for prod:

| var | value |
|---|---|
| `AUTH_URL` | `https://nhatkytrade.com` |
| `AUTH_SECRET` | fresh `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | the **prod** OAuth client |
| `AUTH_GOOGLE_ONLY` | `true` |
| `ENCRYPTION_KEY` | fresh `openssl rand -hex 32` — **back it up offline** |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | strong, **alphanumeric only** (no `@ : / # ?` — they go into a URL) |
| `MYSQL_USER`, `MYSQL_DATABASE` | keep `tranding` (or rename both consistently) |
| `DATABASE_URL` | `mysql://tranding:<MYSQL_PASSWORD>@localhost:3306/tranding` (host-side only) |
| `TRUST_PROXY` | `true` |
| `ADMIN_EMAILS` | the **exact Google email you log in with** (else /admin locks you out) |
| `TELEGRAM_BOT_TOKEN` | the bot token |
| `DB_BACKUP_KEEP_DAYS` | `3` |
| `GEMINI_API_KEY`, `TWELVE_DATA_API_KEY`, … | your keys |

> ⚠️ **`ENCRYPTION_KEY` is permanent.** It encrypts every user's exchange API keys. Change it later and everyone must reconnect their brokers. Choose once, back it up (password manager). Losing it = same result.

## 6. Launch

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

First build takes ~5–10 min on a small CPU. Watch:
```bash
docker compose logs -f app       # look for "applying database migrations…" then "long-poll loop started"
docker compose logs -f caddy
```

## 7. Verify (before announcing)

```bash
docker compose exec app node node_modules/prisma/build/index.js migrate status   # all applied
curl -fsS https://nhatkytrade.com/api/health                                       # {"ok":true,...}
```
In a browser: log in with Google → open **/admin** (must load for your ADMIN_EMAILS account) → **Cài đặt → Kết nối Telegram** → press Start in the bot.

## 8. Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80,443/tcp
ufw enable
```
> ⚠️ Docker publishes container ports via `DOCKER-USER` **before** ufw, so ufw does **not** filter the Caddy container's 443. To keep origin traffic Cloudflare-only, restrict 443 to Cloudflare IPs:
> ```bash
> for c in $(curl -s https://www.cloudflare.com/ips-v4); do iptables -I DOCKER-USER -p tcp --dport 443 -s $c -j ACCEPT; done
> iptables -A DOCKER-USER -p tcp --dport 443 -j DROP
> apt -y install iptables-persistent && netfilter-persistent save
> ```

## 9. Uptime + offsite backup

- **UptimeRobot**: HTTP(s) monitor on `https://nhatkytrade.com/api/health`, 5-min, alert on non-200. Optional keyword `"db":"up"`.
- **Offsite backups** (recommended): `./backups` is local. Push it offsite nightly, e.g. `rclone sync ./backups r2:nkt-backups` via cron. The DB holds base64 screenshots, so keep an eye on disk on `/admin`.

## 10. Update / redeploy

```bash
cd /opt/nhatkytrade && git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
Migrations apply automatically on start. `.env`, `docker/cf-origin/`, and `./backups/` are gitignored so `git pull` never touches them.

---

## Alternative to Caddy: Cloudflare Tunnel (no open ports)

More secure + simpler firewall (zero inbound ports, origin IP hidden, no cert files, no `DOCKER-USER` dance). In Cloudflare **Zero Trust → Networks → Tunnels**, create a tunnel, route hostname `nhatkytrade.com` → `http://app:3000`, copy the token, then instead of the Caddy overlay run a `cloudflared` container:

```yaml
# docker-compose.tunnel.yml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: tranding-tunnel
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on: [app]
```
`docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build` (put `CLOUDFLARE_TUNNEL_TOKEN` in `.env`). With a tunnel, ufw only needs SSH; skip the Caddy/origin-cert/443 steps.
