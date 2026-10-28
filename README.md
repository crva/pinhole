<p align="center"><img src="app-icon.svg" width="96" alt=""></p>

<h1 align="center">Pinhole</h1>

<p align="center">Share any TCP or UDP port with someone else, peer-to-peer and end-to-end encrypted, without opening a port on your router.</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/details-dark.png">
    <img src="docs/screenshots/details-light.png" width="820" alt="Pinhole sharing a game server on TCP port 25565: one joiner connected over a direct P2P path, with the details panel showing live traffic">
  </picture>
</p>

Built with [iroh](https://iroh.computer) (QUIC + hole punching), [Tauri 2](https://tauri.app), React and [shadcn/ui](https://ui.shadcn.com). In English and French.

## Usage

**Host**: *Share* → enter the port of your server (game, website, database…) → *Create share code* → send the `ph1_…` code.

**Joiner**: *Join* → paste the code → *Connect* → in your app, connect to `localhost:<port>`.

- **One joiner at a time** by default (up to 16, reset to 1 for each new share). If someone with the code is turned away because the share is full, the host is warned: the code has leaked, so stop the share and create a new one.
- **Dropped connections** are retried automatically for 5 minutes. When a connection fails, the card says why and what to try.
- **Closing the window** asks whether to keep running in the system tray or quit (which stops every tunnel). Right-click the tray icon to quit later. The choice can be remembered (⚙ *Settings*).
- **Your own relay** (optional): ⚙ *Settings* → *My own relay*, e.g. `https://relay.example.com`. The share code carries the host's relay, so both sides don't need the same setting.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/list-dark.png">
    <img src="docs/screenshots/list-light.png" width="300" alt="The compact window: the share form, then one card per tunnel with its share code or local address">
  </picture>
</p>

## How it works

![How Pinhole works: share code, introduction through the relay, direct path, token check, forwarding](docs/how-it-works.svg)

- **The share code** holds the host's public key, its relay URL, the protocol, the port and a 16-byte secret token. No IP address: if no relay is reachable, sharing fails instead. Each share gets a new key and token, so stopping it kills the code.
- **Direct only**: the relay just introduces the two PCs. Nothing is sent, the token included, until hole punching opens a direct path (20 s at most). If iroh later moves the connection to the relay, it is closed and the joiner reconnects.
- **Token check**: the host checks the token in constant time, then gives the joiner a place or answers that the share is full. A joiner that reconnects keeps its place.
- **Forwarding**: each TCP connection becomes a QUIC stream; each UDP packet a QUIC datagram tagged with its local client.
- **The relay** carries about 50 KB to introduce the PCs, then a keepalive every 5 s on a standby path that Pinhole never uses. It sees both keys, both IP addresses and packet sizes, never the code, the token or your data.

## Security

- Only the code's holder can connect: the host's key pins the encrypted connection (the relay can't read or impersonate it) and the token gates every forwarded byte.
- The joiner listens on `127.0.0.1` only; the host only forwards to its own loopback.
- Per share: 8 connections in setup, 128 TCP connections and 64 UDP flows per joiner.
- The web view is locked down: a strict Content Security Policy (bundled code only, no remote content, no `eval`) and a Tauri capability limited to the app's own commands and its window size. Inputs are validated again in Rust, and text from the other side is never displayed.

## Known limitations

- UDP packets over ~1200 bytes are dropped (QUIC MTU); most games adapt.
- While a place is free, anyone with the code can take it: stop the share when you're done. On the joiner's PC, any program can use the local port.
- The shared service must listen on `127.0.0.1` or `0.0.0.0` (TCP also works on `::1`).
- Someone who finds the host's IP and port can't get in without the code, but can keep the setup slots busy and delay joins.
- A joiner whose app crashed and who rejoins within ~30 s may be refused as "share full" (and the host warned) until the old connection times out.
- iroh can't forbid the relay outright: packets in flight when the watchdog closes a connection may cross it, still encrypted.
- n0's default relays are free but rate limited. For heavier use, [run your own](https://docs.iroh.computer/add-a-relay) (`iroh-relay`) or use [managed relays](https://docs.iroh.computer/iroh-services/relays/managed).

## Development

Needs Node.js 20.19+, Rust 1.88+ and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev       # app with hot reload
npm run tauri build     # installers in src-tauri/target/release/bundle
```

Checks, from `src-tauri/`:

```bash
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

- `PINHOLE_FORCE_RELAY=1 npm run tauri dev` simulates a network that blocks P2P (debug builds only; in PowerShell, set `$env:PINHOLE_FORCE_RELAY=1` first).
- Screenshots come from a demo mode (`src/demo.ts`, dev server only): run `npm run dev -- --port 1431`, then `npm run screenshots`.
- To add a language, copy `src/locales/en.json` to `<code>.json` and translate it; it shows up in the language picker.

```
src/                 React UI (api.ts mirrors the Rust commands, locales/ holds translations)
src-tauri/src/
  tunnel.rs          networking: share, join, direct-only policy, errors (+ tunnel/tests.rs)
  tray.rs            closing the window, tray icon, quitting
  lib.rs             Tauri commands and setup
src-tauri/capabilities/default.json   what the web view may call
docs/                diagram and screenshots
scripts/             screenshot capture
```

## License

[MIT](LICENSE). Bundled fonts keep their own licenses: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
