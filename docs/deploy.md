# Deploying a family's site

One deployment serves one family (it can hold more, each in its own log, but the
app is made for one). There are two ways to run it:

- **[Cloudflare](#on-cloudflare-recommended)** (recommended): no server to look
  after. Workers serves the app and the API; the family's log is a Durable Object
  with its own SQLite, written one entry at a time and never overwritten.
- **[Your own server](#on-your-own-server)**: the Node server in `server/`, behind
  a reverse proxy that gives it HTTPS.

Both run the same API (`server/handler.ts`), send the same security headers
(`public/_headers`), and refuse to start a family without the site's
`CREATE_TOKEN`. Neither can read the family: every entry is sealed on the phones.

## Before you start

- **Node 24 or later** and git on the computer you deploy from (the scripts run
  TypeScript directly).
- **The address.** Choose the family's address first, for good: passkeys (the Face
  ID lock) and the installed app are tied to it, and moving later means every
  phone joins again. HTTPS is required (the browser's crypto, passkeys and the
  service worker work only there).
- **The app's name** on phones: `apple-mobile-web-app-title` in `index.html`, and
  `name` and `short_name` in `public/manifest.webmanifest` (it is «شجرة العائلة» /
  «العائلة» as it comes). The family's own name comes from the family file.
- **The family file**, `data/family/family.json`, plain JSON in the format of
  `src/core/raw.ts`: the family's name, its founder (the root), and each person
  with an `id`, `name`, `sex` (`m` or `f`), `parent` (the father's id) and, when
  known, `mother`, `birth`/`death` years (`{ "v": 1950, "cal": "g" }`, or `"h"` for
  Hijri), `deceased`, and `aliases`. It can be small (the founder and a few
  people): everything else can be added in the app. `tests/e2e/fixture/family.json`
  is a complete made-up example.

```json
{
  "family": { "name": "آل سالم" },
  "root": { "id": "root", "name": "سالم", "sex": "m" },
  "people": [
    { "id": "p1", "name": "صالح", "sex": "m", "parent": "root", "deceased": true },
    { "id": "p2", "name": "فهد", "sex": "m", "parent": "p1", "birth": { "v": 1950, "cal": "g" } }
  ]
}
```

`data/` is in `.gitignore`: the family's names, its keys and links never go into
this repository. If you keep them in git, use a private repository of your own.

```sh
git clone https://github.com/bodaay/family-tree && cd family-tree
npm ci
node scripts/test-kinship.ts && node scripts/test-server.ts   # a quick check (all unit tests: README, "Tests")
mkdir -p data/family data/secrets && chmod 700 data/secrets
openssl rand -hex 32 > data/secrets/create-token              # the secret that starting a family needs
```

## On Cloudflare (recommended)

You need a Cloudflare account and, for your own address, a domain whose DNS is on
Cloudflare. SQLite-backed Durable Objects are included in the Workers Free plan,
which is plenty for one family; the Workers Paid plan raises the limits. (Check
Cloudflare's current plans and limits.)

1. **Configure** `wrangler.jsonc`: set `name` (the Worker's name in your account).
   For your own address, add the route and turn the `workers.dev` address off:

   ```jsonc
   "routes": [{ "pattern": "family.example.org", "custom_domain": true }],
   "workers_dev": false,
   "preview_urls": false
   ```

   Keeping `"workers_dev": true` instead serves it at
   `https://<name>.<your-subdomain>.workers.dev`, which is fine to try it out but
   is an address you cannot take with you.

2. **Sign in and deploy.** `npx wrangler login` opens the browser once. (For a
   script or a second person, a Cloudflare API token made from the "Edit
   Cloudflare Workers" template works instead, in `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`; keep it out of git.)

   ```sh
   npx wrangler login
   npm run deploy                                                   # type check, build, publish
   npx wrangler secret put CREATE_TOKEN < data/secrets/create-token  # once
   ```

   `npm run cf:dev` runs the Cloudflare version on your computer first, if you
   like (port 8789).

3. **Start the family** (once):

   ```sh
   node scripts/init-family.ts --remote https://family.example.org
   ```

   It seals the family file into the log's first entry on your computer, sends
   it with the create token, and writes the root admin's link to
   `data/secrets/invite-live.txt` and a page with its QR code to
   `data/secrets/invite-live.html`. It never prints the link: the link carries the
   family key and the root admin's key in its `#` part, which browsers never send
   to a server. Whoever has it is the root admin, for good.

4. **On the root admin's phone:** open the admin link (or scan the QR code), add the
   app to the Home Screen, turn on the Face ID lock (أنا → الأمان), and make a
   recovery kit kept somewhere safe and offline. On an iPhone or iPad the family
   opens only in the app on the Home Screen: Safari, opening the link, offers to
   copy it; add the app to the Home Screen, open it, and paste the link with
   «لصق رابط» (or scan the QR code from the app). Then mark the main branches, hand
   out the leadership keys, and invite members from the app (الإدارة). Delete the
   link files from your computer once the root admin's phone and kit are set up,
   or keep them only where nobody else can read them.

5. **Updating:** `git pull`, `npm ci`, the tests, `npm run deploy`. Phones pick up
   the new version as they open; a tab still open on the old one is asked to reload.

## On your own server

Any Linux machine with Node 24 or later, a domain pointing at it, and ports 80 and
443 open. The Node server keeps each family's log as files in one folder.

1. **Build and run it** (as a user of its own, listening only on the machine):

   ```sh
   git clone https://github.com/bodaay/family-tree /opt/family-tree && cd /opt/family-tree
   npm ci && npm run build
   ```

   `/etc/systemd/system/family-tree.service`:

   ```ini
   [Unit]
   Description=Family tree
   After=network.target

   [Service]
   User=familytree
   WorkingDirectory=/opt/family-tree
   Environment=HOST=127.0.0.1 PORT=8787 FT_DATA=/var/lib/family-tree
   EnvironmentFile=/etc/family-tree.env
   ExecStart=/usr/bin/node server/index.ts
   Restart=on-failure
   NoNewPrivileges=true
   ProtectSystem=strict
   ReadWritePaths=/var/lib/family-tree

   [Install]
   WantedBy=multi-user.target
   ```

   `/etc/family-tree.env` (readable only by root and that user) holds
   `CREATE_TOKEN=` and the same token as `data/secrets/create-token` on your
   computer. Without `CREATE_TOKEN` anyone who reaches the server could start a
   family on it: the server says so when it starts.

   ```sh
   sudo useradd --system --home /var/lib/family-tree familytree
   sudo install -d -o familytree -m 700 /var/lib/family-tree
   sudo systemctl enable --now family-tree
   ```

2. **HTTPS in front of it.** [Caddy](https://caddyserver.com) gets and renews the
   certificate by itself. `/etc/caddy/Caddyfile`:

   ```
   family.example.org {
       reverse_proxy 127.0.0.1:8787
   }
   ```

   The Node server sends the headers of `public/_headers` (the content security
   policy and the rest) with the app's files; the proxy needs none of its own.

3. **Start the family and set up the root admin's phone** as in steps 3 and 4
   above, with `--remote https://family.example.org`.

4. **Updating:** `git pull && npm ci && npm run build`, then
   `sudo systemctl restart family-tree`.

5. **Backups:** the folder `/var/lib/family-tree` is the whole of it (each
   family's log, sealed). Copy it elsewhere on a schedule; nothing in it can be
   read without the family's key.

## Keeping copies (both ways)

From your computer, with the root admin's link in `data/secrets/invite-live.txt`
and the site in `data/family/site.json` (`{ "url": "https://family.example.org" }`):

```sh
node scripts/backup-log.ts      # data/family/log.json: the log as the server holds it, sealed; run it often
node scripts/sync-family.ts     # data/family/family.json: the people and marriages in plain text
```

`scripts/restore-log.ts` puts a family back on a new server from `log.json`. The
plain `family.json` is readable by whoever has it: keep it as private as the
family itself.

## What the server can and cannot see

- It **cannot** read names, years, marriages, requests or anything else in the
  log: entries are sealed on the phones (AES-256-GCM) and signed (Ed25519).
- It **does** see the family's id, how many entries there are, their sizes and
  times, and the network addresses of the phones that connect.
- Whoever controls the hosting account (Cloudflare or the server) controls the
  code the phones load, and so could change it to read what members open. Keep
  that account to as few people as possible, with two-factor sign-in, and a
  deploy token limited to Workers.
