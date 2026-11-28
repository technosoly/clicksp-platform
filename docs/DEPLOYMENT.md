# Deployment

One Linux server runs everything with Docker Compose; nginx in front terminates HTTPS. The steps to put the store online are under [Going live](#going-live); what the owner must provide first is listed under [What the owner provides](#what-the-owner-provides).

## Containers

| Service | Image | Notes |
|---|---|---|
| `app` | built from `Dockerfile` (target `runtime`) | Next.js standalone server as non-root user `app`, port 3000, Docker `HEALTHCHECK` on `/api/health` |
| `migrate` | built from `Dockerfile` (target `migrate`) | One-off `prisma migrate deploy`; the app starts only after it succeeds |
| `postgres` | `postgres:17-alpine` | Data in volume `postgres-data` |
| `redis` | `redis:7-alpine` | Password required, AOF persistence |
| `meilisearch` | `getmeili/meilisearch:v1.58.0` | Master key required, analytics off |

All ports bind to `127.0.0.1` only. A reverse proxy (Caddy or nginx) will terminate TLS in production (Phase 10).

**Uploaded images** (Phase 6) are stored on the server's disk in `MEDIA_STORAGE_DIR` (Docker: the `media-data` volume at `/app/.data/media`; with `pnpm start`, set an absolute path, because the standalone server runs from `.next/standalone`). Back this folder up together with the database: the database lists the files, the folder holds them. The app serves them itself at `/media/...` with year-long immutable caching, so a CDN or the reverse proxy can cache them. Image processing uses `sharp` (prebuilt libvips binaries, no build step). An S3-compatible adapter (MinIO is no longer published on Docker Hub; a managed Iranian S3 such as ArvanCloud Object Storage is an option) plugs in behind the same storage interface once the owner picks a provider; the `S3_*` variables are not read yet.

Upload limits and caching to set at the reverse proxy (Phase 10):
- Server Actions accept bodies up to 11 MB (`next.config.ts`) so admins can upload photos; Next.js applies that limit to every Server Action. Cap request bodies at the proxy at 1 MB everywhere except `/fa/admin/*` and `/en/admin/*` (nginx `client_max_body_size`), so anonymous requests can't send large bodies.
- `/media/*` responses are `immutable` for a year. A removed image stops being served by the app at once, but copies already in browsers or a proxy cache stay until they expire; purge the proxy cache when an image must disappear immediately.

## Background jobs and search

- **Jobs** run inside every app process (`instrumentation.ts`), with pg-boss 12.40 (https://pgboss.io) keeping its queue in the same PostgreSQL database, schema `pgboss` (created on first start; include it in backups, as `pg_dump` of the whole database does). pg-boss sends each scheduled job once however many app processes run. Times are Tehran time:
  - `outbox-dispatch`, every minute: hands outbox events to the module that handles their topic. Events no module handles yet wait in `outbox_events`. A failing event is retried with a growing delay (30 s doubling, at most an hour) and after 10 attempts is left as `failed` with its last error, for a person to look at.
  - `orders-expire`, every 5 minutes: releases the stock of unpaid orders whose payment window has passed.
  - `imports-process`, every minute and right after an upload or confirmation: checks uploaded product CSV files and applies confirmed ones, about 50 seconds per run (a large file carries on in the next run). Uploaded import files are private files under `private/imports/` in the media storage; back them up with the rest of the media.
  - `search-rebuild`, 03:30 every night, and once on the first start with a search engine: rebuilds the product index.
  - `JOBS_ENABLED=false` turns the runner off (for example in a one-off maintenance container).
  - If the database isn't reachable when the app starts, the runner keeps retrying (1 minute, doubling to 10 minutes) while the site serves. `/api/health` shows its state in `jobs` (`running`, `starting`, `retrying` or `off`); alert when it isn't `running`.
  - The database role needs permission to create the `pgboss` schema on the first start (see ADR 0003).
- **Search**: set `MEILISEARCH_HOST` and `MEILISEARCH_API_KEY` (server-only) to use Meilisearch v1.58. A database trigger writes a `search.product_changed` outbox event whenever a product, its texts, variants or part numbers change, so the index follows within about a minute. Without Meilisearch, or when it doesn't answer within 1.5 seconds, the storefront searches the database instead, so search never goes down with it. Give the app a scoped key instead of the master key: create it once with the master key (`POST /keys` with `actions` `["search", "documents.add", "documents.delete", "indexes.create", "indexes.get", "indexes.delete", "indexes.swap", "settings.update", "tasks.get"]` and `indexes` `["products", "products_rebuild"]`) and set it as `MEILISEARCH_APP_KEY` for Compose. Run Meilisearch with `MEILI_ENV=production` on a server. Brand names are part of the index; a renamed brand shows its new name in search after the nightly rebuild.

## Authentication settings

- `AUTH_SECRET` (required in production, at least 32 characters): encrypts TOTP secrets and keys SMS-code hashes. Keep it in the server's secret store, back it up with the database, and do not rotate it casually: a new value makes existing two-factor enrolments unreadable (admins must enrol again).
- `SMS_PROVIDER`: `none` (phone sign-in off), `kavenegar`, or `console` (development only, refused in production).
- **Kavenegar** (`SMS_PROVIDER=kavenegar`): the code is sent with Kavenegar's Verify Lookup API (`POST https://api.kavenegar.com/v1/<key>/verify/lookup.json`), using a template approved in the Kavenegar panel. Set in the server's `.env` (mode 600) only:
  - `KAVENEGAR_API_KEY`: the API key from the Kavenegar panel (account settings). Never put it in Git, chat or email. It is part of the request URL, so the app never logs that URL.
  - `KAVENEGAR_OTP_TEMPLATE`: the name of the Verify template (letters, digits, `-` and `_`). Its text must contain `%token`, which Kavenegar replaces with the 6-digit code; the wording comes from the template, not from the site. For example: `کد ورود شما به کلیک‌اسپ: %token` and a line saying not to share it. The code is valid for 3 minutes.
  - After editing `.env`: `docker compose --profile app up -d app` (Compose passes both variables to the app). If either is missing or the template name is malformed, the store still starts, phone sign-in shows "not available yet", and the app log says which variable is wrong (never its value).
  - Check: request a code at `/fa/login` with your own number. A refused send is logged as `OTP SMS not sent` with Kavenegar's status code (for example 418 low credit, 424 template not found; the list is in Kavenegar's REST docs, https://kavenegar.com/rest.html).
- `TRUSTED_IP_HEADER` (`x-real-ip` default, or `x-forwarded-for`): the reverse proxy must **overwrite** that header with the client address (nginx: `proxy_set_header X-Real-IP $remote_addr;`). With `x-forwarded-for` the app uses the last entry, which the proxy appends. The app uses it for per-IP rate limits and security logs.
- Session cookies are `Secure` with the `__Host-` prefix in production builds, so the site must be served over HTTPS (local `http://localhost` works in Chrome and Firefox).
- First Super Admin: `docker compose --profile app run --rm migrate pnpm admin:create-super` (or `pnpm admin:create-super` on a checkout with `DATABASE_URL`). There is no web sign-up for admins; further admins are invited from the panel.
- Account recovery: `docker compose --profile app run --rm migrate pnpm admin:reset-link --username <name> [--reset-mfa]` prints a one-time link built from `APP_URL`, so set `APP_URL` to the public address. It signs the account out everywhere and is recorded in the audit log.
- `APP_URL` is also used for the password links shown in the admin panel.
- Content-Security-Policy is sent by the app (`proxy.ts`); a reverse proxy must not add a second, conflicting CSP header.

## Endpoints for monitoring
- `GET /api/health`: 200 while the process serves requests.
- `GET /api/ready`: 200 when the database is reachable, 503 otherwise.

## Building in restricted networks
Production servers never run `pnpm install`; images are built in CI and pushed to a registry the server can reach. If an image must be built where npm is blocked or behind a TLS-inspecting proxy:

```bash
docker build \
  --build-arg NPM_REGISTRY=https://<reachable-npm-mirror>/ \
  --secret id=extra_ca,src=/path/to/proxy-ca.pem \
  --target runtime -t clicksp-app .
```

## External network dependencies

| Dependency | Needed when | Reachability from Iranian hosting | Alternative |
|---|---|---|---|
| npm registry | build only | may be blocked or throttled | build in CI, or an npm mirror via `NPM_REGISTRY` |
| Docker Hub (`node`, `postgres`, `redis`, `getmeili/meilisearch`) | build / first pull | often blocked or rate-limited | mirror images to a reachable registry (ArvanCloud Container Registry or self-hosted) |
| GitHub (source, Actions) | development and CI | can be restricted | keep a mirror of the repository |
| Fonts | never at runtime | n/a | Vazirmatn is bundled in the build |
| Payment gateway (Zarinpal, Zibal, ...) | online payment, once connected | Iranian gateways, reachable from Iranian hosting; the customer's browser goes to the bank page and back to `/api/webhooks/payments/<provider>` | none yet: orders stay awaiting payment. `PAYMENT_PROVIDERS` lists the adapters; credentials are `<PREFIX>_*` server variables. `fake` is for development and tests only and is refused in production |
| Kavenegar SMS API (`api.kavenegar.com`, HTTPS) | customer phone sign-in, when `SMS_PROVIDER=kavenegar` | Iranian provider, reachable from Iranian hosting; the server must be allowed to make outbound HTTPS to it | `SMS_PROVIDER=none`: phone sign-in is off, the rest of the store works. Requests time out after 8 seconds and are not retried automatically. A timeout can still mean the SMS arrives; if the customer asks again, the new code replaces the old one |
| Kavenegar web-push SDK (`cdn.kavenegar.com/sdk/sw.js`) | visitor's browser only, and only if a page registers `/kvn-push-sw.js` as a service worker (none does today) | Iranian provider | the file at `/kvn-push-sw.js` is hosted for Kavenegar's panel setup; nothing on the site loads it |
| Authenticator apps | admins' phones only | offline (TOTP needs no network) | any RFC 6238 app |
| Time server (NTP) for the server clock | always (admin two-factor codes need the clock right to about 30 seconds) | Ubuntu's default `ntp.ubuntu.com` is abroad | the hosting provider's NTP server, see "If the international internet is cut" |
| Google Maps embed (`www.google.com/maps/embed`) | visitor's browser only, and only after they press "Show Google map" on the Contact page, when an admin has pasted an embed code | may be unreachable when international internet is cut | the Contact page draws its own map picture and shows the address, phones and the map-app links (Google Maps, Neshan, Balad) without loading anything from another site; the Contact page's CSP (and no other page's) allows frames from `https://www.google.com/maps/embed` |
| Google Fonts, CDNs, foreign SaaS | not used | n/a | n/a |

The running app has **no** runtime dependency on foreign services (the server's clock needs a reachable time server, see below).

## If the international internet is cut

During a shutdown of international traffic, the Iranian (domestic) network usually keeps working. The running store needs nothing from abroad, so it keeps working for visitors inside Iran **as long as the server, its DNS and its CDN are Iranian** (a server or CDN abroad becomes unreachable).

| What | During an international cut |
|---|---|
| Store pages, cart, search | work (fonts, images and scripts are served by the app itself) |
| Admin sign-in: password + authenticator app code | works: the app computes codes on the phone without internet, and the QR code is made on the server |
| Admin sign-in with a backup code | works (each code once); new codes in **My account > Backup codes** with a current app code |
| Admin lost phone and backup codes | a Super Admin removes their authenticator (People > Admins); the owner of the only Super Admin account runs `pnpm admin:reset-link --username <name> --reset-mfa` over SSH (SSH to an Iranian server works on the domestic network) |
| Customer sign-in by SMS code | works while Kavenegar (an Iranian provider) is reachable from the server; signed-in customers stay signed in (14 days idle, 30 days absolute) |
| Online payment | Iranian gateways, reachable on the domestic network |
| Deploys from GitHub Actions, `git pull`, npm and Docker Hub | stop; the running site is not affected, deploy again when the connection is back |

**Server clock.** Authenticator codes change every 30 seconds, and the server accepts the current code and one step either side, so the server's clock must be right to within about 30 seconds. Ubuntu sets its clock from `ntp.ubuntu.com`, which is abroad: during a long cut the clock slowly drifts and admin codes start failing. Set a domestic time server before going live:

1. Ask the hosting provider for its NTP server address (most Iranian data centres run one).
2. In `/etc/systemd/timesyncd.conf`, under `[Time]`: `NTP=<provider's NTP server>` and `FallbackNTP=ir.pool.ntp.org ntp.ubuntu.com` (`ir.pool.ntp.org` is the NTP Pool's Iran zone; its name may not resolve during a cut, which is why the provider's server comes first), then `sudo systemctl restart systemd-timesyncd`.
3. Check with `timedatectl`: `System clock synchronized: yes`. `timedatectl timesync-status` names the server in use.

When an admin enters a code that would be right a little later or earlier (about 1 to 10 minutes either side), the sign-in is refused like any wrong code (the form only says to check the phone's clock), and a `mfa.clock_drift` security event records the offset in seconds: look for it in the Audit log when admins report that correct codes are refused. If the admin's phone is set to automatic time, the server clock is the one to fix: with no time server reachable, set it by hand from a correct clock (in UTC), `sudo timedatectl set-ntp false && sudo date -u -s "YYYY-MM-DD HH:MM:SS" && sudo timedatectl set-ntp true`. Backup codes do not depend on the clock and keep working meanwhile.

## What the owner provides

Nothing below is needed to build or run the store locally; all of it is needed to open it to customers.

| Item | Why | Where it goes |
|---|---|---|
| A Linux VPS (Ubuntu 24.04 LTS, 4 GB RAM, 2 vCPU, 60 GB SSD is comfortable) at an Iranian provider | the store, its database and search | SSH access for whoever deploys |
| A domain (`.ir` via IRNIC, or `.com`) with DNS `A` records for `@` and `www` pointing at the server | the address customers type | the domain's DNS panel |
| A payment gateway merchant account (Zarinpal, Zibal, ...) with its **sandbox** credentials, then the live ones | online payment | server environment only (`<PREFIX>_*` variables), never in chat, email or Git; an adapter is written from the provider's official documentation and tested in its sandbox first |
| A Kavenegar account with credit and an approved Verify (OTP) template containing `%token` | customer sign-in by phone code | `KAVENEGAR_API_KEY` and `KAVENEGAR_OTP_TEMPLATE` in the server `.env` only, with `SMS_PROVIDER=kavenegar` |
| Enamad (e-Namad) and, if wanted, the Samandehi badge | Iranian gateways require Enamad for a live merchant | added to the footer once issued |

## Going live

1. **Server**: install Docker Engine with the Compose and BuildKit plugins and nginx from the distribution's packages (Ubuntu 24.04: `apt install docker.io docker-compose-v2 docker-buildx nginx certbot`; Docker's own apt repository is often unreachable from Iran). The image build needs about 3 GB of memory, so add a swap file on a server with 4 GB or less; open only SSH (from your own address) and the web ports: `ufw allow from <your-ip> to any port 22 proto tcp`, `ufw allow 80,443/tcp`, then `ufw enable` (add the SSH rule first, or you lock yourself out). Mirror the images listed under External network dependencies if Docker Hub is blocked.
2. **Code and settings**: clone the repository (or copy a release) to `/opt/clicksp`, copy `.env.example` to `.env` (mode 600) and set at least:
   - `APP_ENV=production`, `APP_URL=https://<domain>`, `MEILI_ENV=production`
   - fresh random values: `openssl rand -base64 48` for `AUTH_SECRET`, and `openssl rand -hex 32` for `POSTGRES_PASSWORD`, `REDIS_PASSWORD` and `MEILI_MASTER_KEY` (the two passwords go inside connection URLs, where the `/` and `+` of base64 would break them)
   - `SITE_INDEXING=false` until the store is ready to be found
   - `PAYMENT_PROVIDERS` and the gateway's variables once a real adapter exists (never `fake` in production; the app refuses it).
   - `SMS_PROVIDER=kavenegar`, `KAVENEGAR_API_KEY` and `KAVENEGAR_OTP_TEMPLATE` for customer phone sign-in (see Authentication settings).
3. **Start**: `docker compose --profile app up -d --build` (or pull images built in CI). The `migrate` service applies migrations and the system seed before the app starts. Check `curl -s http://127.0.0.1:3000/api/ready`.
4. **HTTPS**: copy `deploy/nginx/clicksp.conf` to `/etc/nginx/sites-available/clicksp`, replace `example.ir`, enable it, and get a certificate with certbot (`certbot certonly --webroot -w /var/www/certbot -d <domain> -d www.<domain>`; on the first run, comment out the 443 server blocks until the certificate exists). `systemctl reload nginx`. Renewal runs from certbot's timer. If Let's Encrypt is unreachable from the server, use a certificate from the hosting provider. Behind a CDN: keep the CDN's own HTTP-to-HTTPS redirect **on** (when the CDN reaches the server only over HTTPS, nginx's port-80 redirect never runs, so without it visitors could be served over plain HTTP). Let's Encrypt follows that redirect, and both HTTPS server blocks answer `/.well-known/acme-challenge/`, so issuing and renewing work through the CDN. For the first certificate, let the CDN reach the server over HTTP (nginx with only a port-80 block for the challenge); once the certificate exists, switch the CDN to HTTPS towards the server in a mode that verifies the server's certificate. Don't turn the CDN proxy off to get a certificate: that publishes the server's address in DNS history. Behind a CDN that terminates TLS (for example ArvanCloud), nginx sees the CDN's address, so tell it which header carries the visitor's address and trust that header only from the CDN: `set_real_ip_from <each CDN range>;`, `real_ip_header <the CDN's client-IP header>;`, `real_ip_recursive on;` in the server block (keep `proxy_set_header X-Real-IP $remote_addr;`, which is then the visitor), and allow ports 80 and 443 only from the CDN's ranges in the firewall. Without this, every visitor shares one address and one sign-in rate limit.
5. **First Super Admin**: `docker compose --profile app run --rm migrate pnpm admin:create-super`, sign in at `https://<domain>/fa/admin`, enrol two-factor, then invite the Business Admin and staff from the panel.
6. **Search key**: create the scoped Meilisearch key (see Background jobs and search), set `MEILISEARCH_APP_KEY`, restart the app.
7. **Backups**: `scripts/backup.sh /var/backups/clicksp` writes a database dump (custom format, includes the job queue) and an archive of uploaded files with checksums, keeping the newest 14 (`KEEP`). It refuses a folder inside the repository, writes into `<name>.partial` and renames it only when complete, and keeps only complete backups. Run it daily from root's crontab (`30 2 * * * cd /opt/clicksp && BACKUP_AGE_RECIPIENT=age1... scripts/backup.sh /var/backups/clicksp || <alert>`). The backups hold customer, order and account data: **only encrypted copies leave the server**. Install `age`, keep its private key offline (not on the server), set `BACKUP_AGE_RECIPIENT` to the public key, and copy only the `*.age` files and `SHA256SUMS` to storage at another provider each day. Keep `.env` (above all `AUTH_SECRET`) in a separate password manager or secret store, not with the backups: without it, two-factor enrolments can't be read.
8. **Restore drill** (before opening, then every few months): on a spare server or a copy, decrypt the files if needed (`age -d -i <key> -o database.dump database.dump.age`, the same for `media.tar.gz`), then `docker compose --profile app stop app && scripts/restore.sh <backup-folder> --yes && docker compose --profile app up -d app` (the script refuses to run while the app is up, checks the checksums first and restores the database in one transaction), then sign in and open a product and an order. The database part was rehearsed on a development copy: a custom-format `pg_dump` restored with `pg_restore` into an empty database brought back every table, trigger and the job queue with the same row counts. The Docker parts of both scripts still need their first run on the real server.
9. **Open the store**: replace the placeholder pictures and test data, add real products, check prices and stock, place one real order with the live gateway and refund it, then set `SITE_INDEXING=true` (accepted only with `APP_ENV=production`) and restart. `robots.txt` then allows the storefront (not admin, preview, account, cart, checkout, sign-in, search or the API) and names `/sitemap.xml`, which lists home, motorcycles, articles, information pages, categories (only those whose parents are shown too), products and motorcycle models in each language that has its own address; it is rebuilt at most once an hour, and is empty while indexing is off. Submit the sitemap in Google Search Console.
10. **Monitoring**: watch `/api/ready` (database) and `/api/health` (`jobs` must be `running`) from an uptime checker, and the admin overview's waiting and failed background tasks.
