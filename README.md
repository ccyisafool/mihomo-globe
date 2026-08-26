# Mihomo Globe

Mihomo Globe turns Zashboard's Global Connections globe into a focused, standalone page for a Nikki-managed OpenWrt router. Open one local URL and see the router's active Mihomo connections arc across the Earth.

The router serves the page itself. No cloud service receives the Mihomo secret or connection list. A tiny same-origin CGI bridge reads Nikki's generated controller settings on the router and exposes only the read-only `connections`, `version`, public-origin, and health endpoints.

## What it includes

- the interactive space globe, city labels, animated routes, pause, and fullscreen controls;
- selectable 3D globe and animated 2D world-map views;
- Space and Flat visual treatments for the 3D Earth;
- selectable public-origin providers: ipip.net, ip.sb, ipwho.is, and ipapi.is;
- live active connections from Nikki/Mihomo, aggregated by destination city;
- a masked public IP display and automatic origin positioning;
- browser-local IP geolocation using DB-IP City Lite;
- a standalone `uhttpd` instance on the LAN, independent of LuCI and Nikki's dashboard;
- install, status, update, and uninstall commands for OpenWrt.

If the router bridge or geolocation database is not ready, the globe remains alive with a small demonstration route set. On first use, the page asks before downloading the roughly 62 MB DB-IP City Lite database. That database stays in the browser's IndexedDB storage; destination IPs are looked up locally.

## Develop locally

Requirements: Node.js 22.13 or newer.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`. The development server will show the demonstration globe because the OpenWrt CGI bridge is not present.

Production checks:

```sh
npm run lint
npm run build
```

## Build an OpenWrt release

```sh
npm run release
```

This produces:

- `release/mihomo-globe.tar.gz`
- `release/mihomo-globe.tar.gz.sha256`
- `release/install.sh`

Publish those three files at the same HTTPS location. The router needs Nikki, `uhttpd`, `curl`, `yq`, `tar`, and `sha256sum`; current Nikki installations normally already provide the controller-side tools.

## Install on OpenWrt

SSH into the router as root, then run one command with the HTTPS URL where you published the archive:

```sh
MIHOMO_GLOBE_ARCHIVE_URL='https://example.net/mihomo-globe.tar.gz' \
  sh -c "$(wget -qO- 'https://example.net/install.sh')"
```

The default URL is `http://<router-lan-ip>:9091/`. The service binds to the router's LAN address rather than every interface. To change the port:

```sh
uci set mihomo-globe.main.port='9092'
uci commit mihomo-globe
/etc/init.d/mihomo-globe restart
```

For a direct offline upload, copy the archive and adjacent checksum to the router and pass the local path to the installer:

```sh
sh install.sh /tmp/mihomo-globe.tar.gz
```

Useful commands:

```sh
mihomo-globe-status
mihomo-globe-update
mihomo-globe-update 'https://example.net/mihomo-globe.tar.gz'
mihomo-globe-uninstall
```

The updater remembers the archive URL from installation. The installer preserves `/etc/config/mihomo-globe` during updates and keeps one previous copy of the web application in `/usr/share/mihomo-globe.previous`.

### Updates from a private GitHub repository

Private GitHub release assets require authentication. Configure the repository and a fine-grained, read-only token on each router:

```sh
uci set mihomo-globe.main.archive_url=''
uci set mihomo-globe.main.github_repository='OWNER/REPOSITORY'
uci set mihomo-globe.main.github_token_file='/etc/mihomo-globe/github-token'
uci commit mihomo-globe
install -d -m 0700 /etc/mihomo-globe
```

Write the token into `/etc/mihomo-globe/github-token` without placing it on the command line, then protect it with mode `0600`. The token should be fine-grained, restricted to this single repository, and grant only read access to repository contents.

`mihomo-globe-update` then discovers the latest private GitHub release, downloads the archive and checksum through GitHub's authenticated API, verifies the checksum, and installs it. The credential is kept out of process arguments and logs.

Tags matching `v*` automatically build and publish a release through the repository's GitHub Actions workflow.

## Security boundary

- The browser never receives Nikki's Mihomo controller secret.
- The CGI bridge has a fixed read-only endpoint allowlist; it cannot change proxies, rules, or configuration.
- The web server binds to the LAN address by default. Do not expose its port on the WAN.
- Release checksums are verified automatically when the adjacent `.sha256` file is available.
- Private GitHub credentials remain in `/etc/mihomo-globe/github-token`, never in the web root, UCI, release archive, or repository.
- Public-IP discovery uses only the provider selected in the page and requires internet access from the router. The optional DB-IP database download requires browser internet access. Live connections themselves stay on the LAN.

## Origins and licenses

The globe renderer is adapted from [Zashboard](https://github.com/Zephyruso/zashboard), Nikki's default dashboard. Its Earth material follows the [Three.js WebGPU TSL Earth example](https://threejs.org/examples/webgpu_tsl_earth.html). Texture and database attribution is displayed inside the page. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the complete notices.
