# Hidden Chat Overlay — Design

**Status:** Draft
**Date:** 2026-05-18

## Summary

Add a hidden chat feature to the Klecks standalone build. The chat is activated by clicking the **hand** tool button 6 times within a 5-second sliding window. When triggered, an overlay panel appears over the canvas with a basic chat UI (scrollable message list + text input + send button). Messages flow over WebSocket to a new Node.js server that persists them to SQLite forever, and serves the most recent 50 to each newly connected client.

The chat has exactly two **sides** (`klecks` and `peer`), each addressed by its own WebSocket endpoint on the same server. Every connection on `/chat/klecks` is treated as the same logical client; same for `/chat/peer`. The peer side is reached via a separate standalone web page (`peer.html`) that hosts the same chat UI but **without** the hand-tool trigger — it's directly accessible at its own URL. Sent messages render as right-aligned bubbles; received messages as left-aligned bubbles. No usernames are exchanged.

Messages can be either **text** or **image**. Image messages are an additional capability only enabled on the peer (iPhone) page — they let the peer attach a photo from the phone gallery, client-resized before sending, transmitted over the same WebSocket, and rendered as an image bubble on both sides.

## Goals

- A trigger that is non-obvious in normal use but reliable when intentionally invoked.
- Functional two-sided anonymous chat with stable per-side identity (no usernames, but sent/received is preserved across reloads).
- All messages persisted server-side in SQLite, forever.
- Communication via a single WebSocket so the chat traffic is not visible as discrete HTTP requests in the browser network panel by default.
- Klecks-side integration is **standalone build only** — the embed build must not include the easter-egg code.
- Peer side is a separate, directly-reachable page (`peer.html`) that reuses the same `ChatOverlay` component so the two UIs are visually identical.
- **Target devices:** klecks side targets iPad (touch, ~1024 × 768 landscape, iOS Safari); peer side targets mobile phones, primarily iPhone SE 2022 (375 × 667, iOS Safari).
- **Image attachments (peer-only send, both-sides render):** the peer-side compose UI exposes an "attach image" button that opens the iOS photo picker. Selected images are client-resized and sent over the same WebSocket.
- **Automated tests:** a Playwright Test suite (vanilla `@playwright/test`, not MCP-driven) exercises both target devices and the cross-device flow. Runnable via `npm run test:e2e`.

## Non-goals

- Authentication, accounts, identity, presence, or typing indicators.
- Multiple rooms, threads, or DMs.
- Rate limiting or message-length limits (explicitly out of scope per request).
- Message editing, deletion, or moderation.
- E2E encryption. Server sees plaintext; messages are stored in plaintext.
- Image **attachments** on the klecks (iPad) side — peer only sends images; klecks only receives/displays them.
- Image preview / edit / crop before sending — selected images are sent as-is (after a fixed downscale).
- Multiple images at once, drag-and-drop image insertion, video/audio/file attachments.
- Server-side image processing (resize, thumbnailing, format conversion). All resizing happens client-side before upload.

## Architecture overview

A **single** container (`klecks`) hosts everything: the Node chat server, which serves both static files from `dist/` and WebSocket upgrades on `/chat/*`. Same origin for klecks (`/`), peer (`/peer.html`), and chat WS (`/chat/{klecks,peer}`).

```
                          ┌─────────────────────────────────────────────────┐
                          │  klecks container (Node, single process)        │
                          │                                                 │
  Browser visits "/"  ───▶│  HTTP: serve dist/                              │
                          │    · /            → index.html  (klecks)        │
                          │    · /peer.html   → peer page                   │
                          │    · /help.html   → help page                   │
                          │    · /app/*       → assets, JS, CSS, fonts      │
                          │                                                 │
  WS /chat/klecks   ─────▶│  WS upgrade handler                             │
  WS /chat/peer     ─────▶│    · path → side ('klecks' | 'peer')            │
                          │    · ChatRoom (in-memory connection set)        │
                          │    · broadcast to both sides                    │
                          │                                                 │
                          │  better-sqlite3 at $CHAT_DB_PATH                │
                          │  (mounted as docker volume → persists)          │
                          └─────────────────────────────────────────────────┘

                          klecks tab                  peer tab
                          ──────────                  ────────
                          ToolspaceToolRow             peer-main.ts
                                │ onActivate('hand')        │
                                ▼                           ▼
                          HandClickDetector ───▶ ChatOverlay (closeable: true / false)
                                                       │
                                                       ▼
                                                  ChatClient ──▶ ws://same-origin/chat/<side>
```

New code lives in two places:

- **Frontend** — `src/app/script/klecks/easter/` (new directory).
- **Server** — `server/` (new top-level sibling directory, separate `package.json`).

## Components

### 1. Trigger: `HandClickDetector`

**File:** `src/app/script/klecks/easter/hand-click-detector.ts`

**Integration point:** `ToolspaceToolRow.onActivate(toolStr)` in `kl-app.ts` (line ~663 region). The detector is constructed alongside the toolspace and wrapped around the existing `onActivate` callback — it inspects every tool activation, then forwards the call unchanged.

**Logic:**

- Maintain an array of timestamps of recent hand-tool activations.
- On every tool activation:
  - If `toolStr === 'hand'`: push `performance.now()` onto the array.
  - Else: clear the array (any non-hand tool resets the streak).
- Prune timestamps older than 5000 ms.
- If the array length reaches 6, fire the `onTrigger` callback and clear the array (a future trigger requires another 6 within 5 s).

**API sketch:**

```ts
class HandClickDetector {
    constructor(p: { onTrigger: () => void });
    record(toolStr: TToolType): void;  // call from onActivate wrapper
}
```

**Notes:**

- 5-second sliding window — six clicks at any cadence inside a single rolling 5 s window trigger the overlay.
- Counter resets when a different tool is selected, even within the 5 s window. This is what makes "in a row" still meaningful.
- The detector is only constructed in `main-standalone.ts` (see § 5).

### 2. UI: `ChatOverlay`

**Files:** `src/app/script/klecks/easter/chat-overlay.ts` + `chat-overlay.module.scss`

Pure DOM class following Klecks's existing convention (`getElement(): HTMLElement`, no framework, no JSX).

**Structure:**

```
+-----------------------------+
|  chat                    ×  |  ← header, close button
+-----------------------------+
|  ┌────────────┐             |
|  │ hi          │             |  ← received (left)
|  └────────────┘             |
|              ┌────────────┐ |
|              │ hello       │ |  ← sent (right)
|              └────────────┘ |
|     ... (scrollable) ...    |
+-----------------------------+
|  [type a message…]  [Send]  |  ← input row
+-----------------------------+
```

**Constructor options:**

```ts
type TChatOverlayOptions = {
    client: ChatClient;
    closeable: boolean;        // klecks: true;  peer: false
    allowImageUpload: boolean; // klecks: false; peer: true
    onClose?: () => void;      // called when user clicks ×; ignored if !closeable
};
```

**Target devices:**

- **Klecks side (overlay) — iPad** (~1024 × 768 in landscape, typical 9th/10th-gen iPad).
- **Peer side — iPhone SE 2022** (375 × 667, portrait). Other mobile phones in the same size class are also supported.

Both targets are touch-first (no mouse hover, no right-click) and run iOS Safari, which means the dynamic viewport (URL bar) and the virtual keyboard both shrink the visible area at runtime.

**Behavior:**

- Fixed-position, anchored bottom-right of the **visual viewport** (not just `window.innerHeight`), with edge padding of 8 px + iOS safe-area insets.
- Sizing rules:
  - Default size: 320 × 420 px (the iPad landscape case — sits in the bottom-right corner of the canvas).
  - On narrow viewports (`width ≤ 480 px`, hits iPhone SE): width becomes `calc(100vw - 16px)`, height becomes `calc(100dvh - 16px - env(safe-area-inset-bottom) - env(safe-area-inset-top))`. The overlay then effectively fills the screen, which is what the peer page on a phone needs.
  - Use `dvh` (dynamic viewport height) rather than `vh`, so the overlay resizes correctly when iOS Safari's URL bar collapses/expands.
- Identical DOM structure across both targets — only CSS adapts.
- Constructed and appended to `document.body` on first trigger (klecks) or page load (peer); subsequent klecks triggers re-show the existing instance (idempotent).
- Klecks side (`closeable: true`): the `×` button hides the panel and closes the underlying WebSocket. Re-triggering the 6-click sequence reopens it and reconnects.
- Peer side (`closeable: false`): the `×` button is **not rendered**. The overlay is visible from page load until the tab is closed. The WebSocket stays open for the page's lifetime.
- Auto-scrolls to the bottom on new messages **unless** the user has scrolled up (preserve scroll position when reading history). After the iOS keyboard appears and shrinks the visual viewport, the message list re-anchors to bottom.
- `Enter` in the input sends. The send button is also tappable and is sized ≥ 44 × 44 px to meet iOS touch-target guidance.
- Empty / whitespace-only messages are not sent.
- **Image rendering (both sides):** image bubbles render an `<img>` thumbnail loaded from `data:image/jpeg;base64,…`. Thumbnail constraints inside the bubble: `max-width: 100%`, `max-height: 240px`, preserves aspect ratio, `cursor: pointer`. Tapping/clicking the thumbnail opens a fullscreen lightbox overlay with the same image at natural size (CSS `max-width: 100vw; max-height: 100dvh; object-fit: contain;`), tinted backdrop, single tap/click anywhere or `Esc` closes it. The lightbox is implemented as a sibling overlay (separate `position: fixed` element appended to `document.body`), not nested inside `ChatOverlay`, so it sits above everything including Klecks modals when active.
- z-index (klecks side): above easel/canvas, below Klecks modals. Klecks's modal layer uses `DIALOG_COUNTER`; the overlay sits below the modal stack so dialogs (e.g. color picker, file dialogs) opened while the overlay is up still render correctly.
- Pointer events are scoped to the overlay's bounding box; on the klecks side the rest of the canvas remains interactive. On the peer page nothing else is interactive.
- `touch-action: manipulation` on tappable elements (send button, close button) to suppress iOS's 300 ms double-tap zoom delay.

**Keyboard focus interaction (klecks only):** When the chat input is focused, the global `KeyListener`-style shortcuts in Klecks should not fire (drawing keyboard shortcuts must not steal typing). The overlay stops `keydown`/`keyup` propagation while its input is focused, which is the same mechanism Klecks already uses for its text-tool modal. On the peer page there are no global shortcuts to worry about, but the same propagation-stop is harmless and kept for symmetry.

**Image upload (peer side, `allowImageUpload: true` only):**

- The input row renders an extra round button ("+") **left** of the text input, ≥ 44 × 44 px, with `touch-action: manipulation`.
- The button is wired to a hidden `<input type="file" accept="image/*">`. iOS Safari turns this into a photo-picker prompt (camera + library).
- On `change`, the selected `File` runs through a small `prepareImageForSend` helper colocated with `ChatOverlay`:
  1. Decode to a `HTMLImageElement` via `URL.createObjectURL` + `<img>` onload.
  2. Draw to an offscreen `<canvas>` resized so the long edge ≤ **1024 px** (no upscale if already smaller).
  3. Export as JPEG quality `0.8` via `canvas.toDataURL('image/jpeg', 0.8)`.
  4. Strip the `data:image/jpeg;base64,` prefix to get the raw base64 string.
- The base64 payload is passed to `client.sendImage(base64)`. No preview/confirm step — selection sends immediately.
- The button is disabled briefly between selection and the send round-tripping (avoid accidental double-send by mashing).
- If the user cancels the picker, nothing happens (no error UI).
- Errors during decode/resize are logged to console and surfaced as a transient "couldn't send image" inline message bubble — no modal alerts.

The button is **not rendered at all** when `allowImageUpload: false` (klecks side).

### 3. Client: `ChatClient`

**File:** `src/app/script/klecks/easter/chat-client.ts`

**Responsibilities:**

- Open a WebSocket to the chat server.
- Hand received `history` and `message` frames to the overlay via a listener.
- Queue outgoing messages while disconnected and flush on reconnect.
- Reconnect with exponential backoff (250 ms → cap 30 s, reset on successful open).

**URL resolution:** the caller (klecks entrypoint or `peer-main.ts`) is responsible for passing the side-specific path. A small shared helper `resolveChatUrl(side: 'klecks' | 'peer'): string` lives next to `ChatClient` and derives the URL from `window.location`:

- protocol: `wss:` if page is `https:`, else `ws:`
- host: `window.location.host`
- path: `/chat/<side>`

Because static files **and** WS share the same origin (one container, one port — see § 5 and § 7), no build-time `CHAT_WS_URL` override is needed. The klecks entrypoint calls `resolveChatUrl('klecks')`; `peer-main.ts` calls `resolveChatUrl('peer')`. `ChatClient` itself just takes a fully-formed URL — it does not know which side it's on.

**API sketch:**

```ts
type TChatMessageBody =
    | { kind: 'text'; text: string }
    | { kind: 'image'; data: string }; // base64-encoded JPEG, no data: prefix

type TChatIncoming =
    | { type: 'history'; messages: (TChatMessageBody & { mine: boolean })[] }
    | { type: 'message'; mine: boolean } & TChatMessageBody;

class ChatClient {
    constructor(p: { url: string; onMessage: (m: TChatIncoming) => void; onStatus: (s: 'connected' | 'disconnected') => void });
    sendText(text: string): void;
    sendImage(base64Jpeg: string): void;
    close(): void;
}
```

### 4. Wire protocol

JSON frames, both directions. Every message has a `kind`: `"text"` or `"image"`. Text messages carry a `text` field; image messages carry a `data` field with raw base64-encoded JPEG bytes (no `data:image/jpeg;base64,` prefix — the client re-prefixes when rendering).

**Client → server (text):**

```json
{ "type": "send", "kind": "text", "text": "hello world" }
```

**Client → server (image):**

```json
{ "type": "send", "kind": "image", "data": "<base64 jpeg>" }
```

The server does **not** distinguish between sides for image acceptance — any connection may send any kind. The "only peer can send images" property is enforced only at the UI layer (klecks side never renders the "+" button when `allowImageUpload: false`). This is acceptable per the existing trust model: both endpoints are already untrusted (see Risks).

**Server → client (on connect):**

```json
{
  "type": "history",
  "messages": [
    { "kind": "text", "text": "older message", "mine": false },
    { "kind": "image", "data": "<base64 jpeg>", "mine": true },
    { "kind": "text", "text": "...up to 50 entries total...", "mine": true }
  ]
}
```

Each history entry's `mine` is resolved server-side as `entry.sender === connection.side`. Because `side` is endpoint-derived (and therefore stable across reloads), a klecks client sees its own past sent messages as right-aligned (sent) bubbles even after a refresh.

**Server → client (live):**

```json
{ "type": "message", "kind": "text", "text": "hi", "mine": true }
{ "type": "message", "kind": "image", "data": "<base64 jpeg>", "mine": false }
```

For each broadcast the server computes `mine = (message.sender === recipient.side)` per recipient. The originating side gets `mine: true`; the opposite side gets `mine: false`. The message is broadcast to **both** endpoint groups so all connected clients on either side see it.

Malformed frames are dropped silently on both sides. Frames with unknown `type` or `kind` are ignored. Image frames whose `data` is not decodable base64 are dropped server-side and not broadcast.

### 5. Server

**Location:** `server/` (top-level sibling of `src/`), with its own `package.json`. Keeps Node-only dependencies out of the parcel bundle and out of the existing root `package.json`.

**Responsibilities:** this is the **single** runtime process inside the container. It (a) serves static files from `dist/` (the parcel build output) for `GET` requests and (b) handles WebSocket upgrades on `/chat/klecks` and `/chat/peer`. It replaces the existing `npx serve dist` entrypoint.

**Stack:**

- Node ≥ 20
- `ws` (WebSocket library)
- `better-sqlite3` (synchronous SQLite; simple and fast for this scale)
- `sirv` (small, well-known static file middleware for Node — no Express needed)
- Plain `node:http` server — no Express. Used for the WS upgrade, the `sirv` static handler, and a `GET /health` endpoint that returns `200 OK`.
- TypeScript via `tsx` for dev; production runs compiled JS or `tsx` directly (decided in the implementation plan).

**Files:**

```
server/
  package.json
  tsconfig.json
  src/
    index.ts         # http + ws + static bootstrap
    chat-room.ts     # in-memory connection set + broadcast
    db.ts            # better-sqlite3 wrapper, schema init, queries
    static.ts        # sirv config wrapping the dist/ directory
  README.md          # how to run locally
```

**Static serving:**

- `sirv(distDir, { single: false, dev: false })` mounted as the HTTP handler for non-`/chat/*` paths.
- `distDir` resolved from `CHAT_STATIC_DIR` env (default: `../dist/` relative to `server/`, which matches the layout after a full repo `npm run build` + `npm run build:peer` + `npm run build:help`).
- `/` serves `index.html` (klecks standalone). `/peer.html` serves the peer page. `/help.html` serves help. All assets (`/app/*`) served as-is.
- If `distDir` doesn't exist on startup, the server logs a warning and serves only `/health` + WS endpoints. (Useful for `tsx` dev where you may run klecks via parcel separately and just want the WS server.)

**SQLite schema:**

```sql
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender      TEXT    NOT NULL CHECK (sender IN ('klecks', 'peer')),
    kind        TEXT    NOT NULL CHECK (kind IN ('text', 'image')),
    text        TEXT,                -- non-null when kind='text'
    image_data  BLOB,                -- non-null when kind='image' (raw JPEG bytes, not base64)
    created_at  INTEGER NOT NULL,    -- unix ms
    CHECK (
        (kind = 'text'  AND text IS NOT NULL AND image_data IS NULL) OR
        (kind = 'image' AND text IS NULL AND image_data IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
```

Images are stored as **raw bytes** (BLOB), not base64 — the server decodes base64 from incoming frames before insert and re-encodes when serving history. This keeps disk usage roughly 33% smaller than storing base64 directly.

**Endpoints:**

- `/chat/klecks` (WS upgrade) — every connection labeled `side = 'klecks'`.
- `/chat/peer` (WS upgrade) — every connection labeled `side = 'peer'`.
- Any other path under `/chat/*` returns HTTP 404 on the upgrade attempt.
- All other `GET` requests fall through to the static handler.
- `GET /health` returns `200 OK` and is served directly, bypassing the static handler, to keep health checks independent of `dist/` existence.

**Server logic:**

1. On startup, open SQLite at `process.env.CHAT_DB_PATH || './chat.db'`, run schema init.
2. On WebSocket upgrade:
   - Inspect the request path. If `/chat/klecks` → `side = 'klecks'`. If `/chat/peer` → `side = 'peer'`. Else reject.
   - Query last 50 messages ordered by `created_at ASC` (so the client renders oldest→newest).
   - For each row, re-encode `image_data` as base64 if `kind = 'image'`. Build the history payload.
   - Send `{ type: 'history', messages: [...] }`, with each entry's `mine` computed as `entry.sender === side`.
   - Add the connection to the in-memory room, tagged with its `side`.
3. On incoming `{ type: 'send', kind: 'text', text }`:
   - Trim leading/trailing whitespace. If empty, ignore.
   - Insert with `kind = 'text'`, `text = <trimmed>`, `image_data = NULL`, `sender = side`, `created_at = Date.now()`.
   - Broadcast `{ type: 'message', kind: 'text', text, mine: <c.side === side> }` to every connection `c`.
4. On incoming `{ type: 'send', kind: 'image', data }`:
   - Decode the base64. If decode fails or the result is empty, drop silently.
   - Insert with `kind = 'image'`, `text = NULL`, `image_data = <bytes>`, `sender = side`, `created_at = Date.now()`.
   - Broadcast `{ type: 'message', kind: 'image', data: <base64>, mine: <c.side === side> }` to every connection `c`. (The server re-encodes from the stored bytes to base64 once per broadcast; cheap.) Accepted on **both** endpoints — the UI-only gate is the sole restriction on who can send images.
5. On disconnect: remove from in-memory room. DB untouched.
6. Logging: connection open/close (with side), message count per minute, errors. Plain `console.log` — no logger framework. Image messages log size in bytes, not content.

**Configuration (env vars):**

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | HTTP/WS port (matches the current Dockerfile/`docker-compose.yml` mapping `5050:3000`) |
| `CHAT_DB_PATH` | `./chat.db` | SQLite file path |
| `CHAT_STATIC_DIR` | `../dist/` (relative to `server/`) | Directory served as static files |

No CORS handling needed — static files and WS share the same origin in the docker deploy. (Local dev where you may run parcel `serve` and the chat server separately is handled by leaving `CHAT_STATIC_DIR` unset / absent, so the server only handles WS + health.)

### 6. Peer page (`peer.html`)

**Files (new):**

- `src/peer.html` — minimal HTML shell. Loads `peer-main.ts`. No loading screen, no Klecks chrome.
- `src/app/script/peer-main.ts` — entrypoint. Imports `ChatOverlay` and `ChatClient` from `klecks/easter/`. Constructs them with the peer endpoint and `closeable: false`, mounts to `document.body`.

**Behavior:**

- Loads with an empty page (neutral background, matching the dark/light theme detection used in `src/index.html`).
- Immediately mounts `ChatOverlay` with `closeable: false` and **`allowImageUpload: true`**, anchored bottom-right; responsive sizing fills the iPhone SE viewport (see § 2 sizing rules).
- Connects to the WS server at path `/chat/peer`.
- No hand-tool detector, no Klecks code paths. The page does not import `main-standalone.ts` or any of `klecks/kl.ts`.

**URL:** after `npm run build:peer`, `dist/peer.html` ships alongside `dist/index.html`. The chat server (§ 5) serves it at `/peer.html` on the same origin and port as klecks. **The peer URL is therefore `http://<klecks-host>/peer.html`** — same host, same port as the main klecks site. There is no separate service or port for the peer page.

**Discoverability tradeoff:** the user has explicitly accepted that `peer.html` is reachable at a publicly-guessable URL on the klecks host. If you want it hidden, you'd need to gate it via reverse-proxy auth or rename the route — out of scope here.

**Shared code:** `ChatOverlay`, `ChatClient`, and `resolveChatUrl` live under `src/app/script/klecks/easter/` and are imported by **both** the klecks side (via the trigger wiring in `kl-app.ts`) and `peer-main.ts`. No code duplication; both parcel entries bundle the same source.

### 7. Build & integration

- **Standalone-only inclusion (klecks side):** the easter-egg trigger code is imported from `main-standalone.ts` only. `main-embed.ts` does not import any of `src/app/script/klecks/easter/`. This is hygiene — the existing Dockerfile does not run `build:embed`, so embed is never shipped in this deploy. `peer-main.ts` is a separate entry and is not bundled into either klecks build.
- **Trigger wiring:** in `kl-app.ts`, the existing `new ToolspaceToolRow({ onActivate: ... })` call is wrapped:

  ```ts
  const handClickDetector = new HandClickDetector({
      onTrigger: () => showChatOverlay(),
  });
  const toolspaceToolRow = new ToolspaceToolRow({
      onActivate: (tool) => {
          handClickDetector.record(tool);
          originalOnActivate(tool);
      },
      // ...
  });
  ```

  `showChatOverlay()` lazily constructs `ChatOverlay` + `ChatClient` on first call.
- **npm scripts (root `package.json`):**
  - `build:peer` (new) → `parcel build src/peer.html`
  - `start` (extended) → `parcel serve src/index.html src/peer.html` so both pages are reachable in dev (still no chat-server unless you also start it from `server/`).
  - `test:e2e` (new) → `playwright test`
  - `test:e2e:ui` (new) → `playwright test --ui` (interactive dev runner)
- **npm scripts (`server/package.json`):**
  - `build` → compile TS for production (or run via `tsx` — implementation plan decides).
  - `start` → run the chat server (serves static + WS).
  - `start:dev` → `tsx watch src/index.ts`.
- **Dev dependency (root):** `@playwright/test` — added for the automated test suite (see § 9). Not bundled with the app; not present in the container image.

## 8. Docker / docker-compose

There are two intended deploy shapes. **Both are supported by the same code** — they differ only in whether `CHAT_STATIC_DIR` is set, which is the toggle that decides whether the chat server also serves `dist/`.

- **8a. Dev / simple-deploy (default in this repo's compose file).** Single container, chat server serves static **and** WS. One port, one origin, `docker compose up` and you're done.
- **8b. Production with external traefik + nginx (this user's deploy).** Two roles, possibly two containers: nginx serves `dist/`, the chat container handles WS only. Traefik routes `/chat/*` to the chat container and everything else to nginx. `CHAT_STATIC_DIR` left empty so the chat container's `sirv` handler is disabled.

### 8a. Dev / simple-deploy

This is what the repo's own `docker-compose.yml` ships and what `docker compose up` produces. Single container, sufficient for local testing and any small hobby deploy without a reverse proxy.

**Dockerfile (replaces current):**

```Dockerfile
FROM node:20

WORKDIR /var/www
COPY . /var/www

# Install root deps and build all parcel artifacts (klecks, peer, help).
RUN npm ci
RUN npm run lang:build
RUN npm run build         # → dist/index.html + assets
RUN npm run build:peer    # → dist/peer.html
RUN npm run build:help    # → dist/help.html

# Install and build the chat server.
WORKDIR /var/www/server
RUN npm ci
RUN npm run build         # if a compiled build is chosen; otherwise tsx at runtime

# Runtime: chat server serves dist/ + WS + health.
ENV PORT=3000
ENV CHAT_DB_PATH=/var/www/chat-data/chat.db
ENV CHAT_STATIC_DIR=/var/www/dist
EXPOSE 3000
ENTRYPOINT ["npm", "run", "start"]
```

Key points:

- The `RUN npm install serve -g` line from the existing Dockerfile is **removed** — `npx serve` is no longer the runtime.
- The new entrypoint is the chat server (running from `/var/www/server`).
- Port `3000` inside the container is unchanged, so `docker-compose.yml`'s `5050:3000` mapping continues to work.
- The DB lives in `/var/www/chat-data/` so a volume can mount over it and persist `chat.db` across `docker compose down`.

**docker-compose.yml (updated):**

```yaml
version: '3'

services:
    klecks:
        build: .
        container_name: klecks
        ports:
            - 5050:3000
        volumes:
            - chat-data:/var/www/chat-data

volumes:
    chat-data:
```

Still one service, still one mapped port. The only addition is the named volume for SQLite persistence.

**Result:** `docker compose up -d` produces a single container reachable at `http://localhost:5050/` for klecks, `http://localhost:5050/peer.html` for the peer page, and `ws://localhost:5050/chat/{klecks,peer}` for the chat WS. `chat.db` survives container recreation.

### 8b. Production variant (external traefik + nginx)

This is **not** part of the repo's compose file — it's a documented deployment recipe for an environment that already has traefik routing traffic and nginx serving static files.

Roles:

- **nginx (existing, external):** serves the contents of `dist/` from wherever you've published the build artifact. Equivalent to today's static deploy.
- **chat container:** same image as 8a, but launched with `CHAT_STATIC_DIR=` (empty). The `sirv` handler logs a warning at startup and the server handles only `/chat/*` WS upgrades + `GET /health`. No static files are served from the container.
- **traefik (existing, external):** routes `/chat/*` (and the WS upgrade) to the chat container; routes everything else to nginx. The single-origin assumption holds because traefik unifies the two upstreams under one host — same as 8a from the browser's perspective.

The exact traefik labels / nginx config are operational and depend on your existing setup; not pinned in this spec. The key contracts the deploy must satisfy:

1. `/` and `/peer.html` (and `/app/*`, `/help.html`) reach **nginx**, which serves them from the latest `dist/` build.
2. `/chat/klecks` and `/chat/peer` reach **the chat container** and complete a WebSocket upgrade.
3. Both upstream paths appear to the browser as the same origin, so the runtime-derived `ws://<host>/chat/<side>` URL works without any build-time configuration.
4. The chat container has a persistent volume mounted at `$CHAT_DB_PATH`'s parent dir so `chat.db` survives restarts.

If those four contracts hold, the same Dockerfile from § 8a is the chat container image — no separate build target needed.

## 9. Automated test suite

All test scenarios are implemented as a **Playwright Test** suite using `@playwright/test` (vanilla CLI, not driven from any agent / MCP). Tests live in the repo, run via `npm run test:e2e`, and are intended to be runnable both locally and (eventually) in CI.

**Implementation methodology — Test-Driven Development:**

Every component below is implemented under the **`superpowers:test-driven-development`** skill (file: `superpowers/skills/test-driven-development/SKILL.md`, with `testing-anti-patterns.md` alongside it). The skill is the authoritative source for the TDD loop, the Iron Law ("no production code without a failing test first"), the mandatory verify-red / verify-green checks, and what counts as a legitimate red. **This spec does not restate those rules — invoke the skill at the start of each component's implementation.**

For this project specifically:

- The "tests" the skill refers to are **Playwright Test specs** (`tests/e2e/*.spec.ts`) plus their PageObjects. Where the skill assumes a fast unit-test loop, the equivalent here is a single spec or scenario run via `npm run test:e2e -- <pattern>`. Iteration is slower than unit tests (seconds, not ms), but the red/green/refactor cadence and Iron Law apply verbatim.
- Verify-red specifically means: the spec is wired into the suite, runs, and **fails because the production code or wiring doesn't exist yet** — not because of a typo'd selector, an unstarted container, a wrong test-ID, or a missing `data-testid` attribute. If the failure isn't behavioral, fix the spec until it is, then re-run before writing any production code.
- "Minimal code to pass" means: only the production code path the current spec exercises. Don't pre-build later components from the dependency-ordered list; the next component's spec will drive its own code.
- The dependency-ordered component sequence (`HandClickDetector` → `ChatOverlay` skeleton → `ChatClient` + minimal server → text send → peer page → persistence → image upload → lightbox → cross-device) is sequenced in the writing-plans output, not here. Each step has its own red/green/refactor cycle.
- **Commit after every component.** Each completed component (test green, refactor done) is a single atomic commit on the feature branch before moving to the next. This means: if `HandClickDetector` is implemented and its spec passes, commit it before starting `ChatOverlay`. Rationale: each commit is a self-consistent, working state of the branch — easy to bisect, easy to revert one component without losing later work, easy for a reviewer to walk forward through the feature. The writing-plans output should make each component a separately-committable unit.

Specs and PageObjects are committed alongside the production code in the same commits, not as a big-bang drop at the end.

**Page Object Model:** UI interactions are mediated through PageObject classes (one per logical surface), **not** raw `page.locator(...)` calls inside specs. Specs read as scenario prose ("trigger the chat, send a message, assert a bubble appears"); selectors and low-level actions are encapsulated in PageObjects. This keeps specs resilient to DOM changes — when a selector or interaction pattern changes, only its PageObject method changes.

**Files:**

```
playwright.config.ts             # at repo root
tests/
  e2e/
    klecks-trigger.spec.ts       # V1: trigger happy + negative paths
    klecks-overlay.spec.ts       # V1: send, z-index, keyboard focus, close
    peer-mount.spec.ts           # V2: auto-mount, responsive sizing, touch sizes, no zoom
    peer-input.spec.ts           # V2: text send, virtual keyboard
    peer-image-upload.spec.ts    # V2: image picker → resize → send → render
    cross-text.spec.ts           # V3: text in both directions, reload persistence
    cross-image.spec.ts          # V3: image peer→klecks, lightbox, no "+" on klecks
    cross-restart.spec.ts        # V3: docker compose restart, history survives
  pages/
    klecks.page.ts               # PageObject: the standalone klecks app
    peer.page.ts                 # PageObject: peer.html
    chat-overlay.page.ts         # PageObject: ChatOverlay component (used by both klecks + peer pages)
    image-lightbox.page.ts       # PageObject: the fullscreen image lightbox
  fixtures/
    test-image.jpg               # ~3 MB JPEG used by image-upload tests
  helpers/
    ws-capture.ts                # helper: capture outgoing/incoming WS frames via page.on('websocket')
    docker.ts                    # helper: docker compose restart (used by cross-restart)
```

**PageObject conventions:**

- One class per file. Each class takes a `Page` (or `BrowserContext`, for cross-device tests) in its constructor.
- Public methods are scenario-level verbs (`triggerChat()`, `sendText(s)`, `attachImage(filepath)`, `expectBubble({ side, text })`, `openLightbox()`, etc.). They use Playwright's auto-waiting locators internally.
- Selectors are private — preferably `data-testid="..."` attributes added to production code where stable, with text-content / role selectors as a fallback. The spec adds `data-testid` attributes to:
  - The hand-tool button (likely already discoverable, but `data-testid="tool-hand"` removes ambiguity).
  - The chat overlay root, message list, bubbles, text input, send button, close button, attach button, and the lightbox root.
- PageObject methods return either `void` or a value the spec asserts on. They do **not** assert internally — assertions live in specs, so failures point at scenarios, not at PageObject internals.

Example shape:

```ts
// tests/pages/chat-overlay.page.ts
export class ChatOverlayPage {
    constructor(private page: Page) {}
    locator() { return this.page.getByTestId('chat-overlay'); }
    isVisible() { return this.locator().isVisible(); }
    async sendText(text: string) { /* ... */ }
    async attachImage(path: string) { /* ... */ }
    bubbleAt(index: number) { return this.locator().getByTestId('chat-bubble').nth(index); }
    async openLightbox(bubbleIndex: number) { /* tap bubble's <img> */ }
}
```

This file structure is what the writing-plans output will sequence into; specs and pages are committed alongside their corresponding production code per the TDD loop above.

**`playwright.config.ts` shape:**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // shared backend state (sqlite) → serial
    retries: 0,
    use: {
        baseURL: 'http://localhost:5050',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'klecks-ipad',
            use: { ...devices['iPad (gen 7) landscape'] },
            testMatch: /klecks-.*\.spec\.ts$/,
        },
        {
            name: 'peer-iphone-se',
            use: { ...devices['iPhone SE'] },
            testMatch: /peer-.*\.spec\.ts$/,
        },
        {
            name: 'cross-device',
            // No device set at project level; cross-device tests build two contexts in-test
            // (one with devices['iPad ...'], one with devices['iPhone SE']).
            testMatch: /cross-.*\.spec\.ts$/,
        },
    ],
});
```

**Running the suite:**

1. Bring the stack up: `docker compose build && docker compose up -d`. Tests assume `http://localhost:5050` is responsive.
2. **Each spec file resets DB state in its `beforeAll`** by deleting the `chat-data` volume's contents through a small admin path — actually, simpler: the test helper opens both WS endpoints, drains history, and starts each scenario by using uniquely-tagged message contents (timestamps in messages) so tests don't interfere even with shared persistent storage. Persistence-specific tests (V3 reload, V3 container restart) explicitly orchestrate state.
3. `npm run test:e2e` runs all three projects sequentially (klecks-ipad → peer-iphone-se → cross-device).
4. `npm run test:e2e:ui` opens the Playwright UI runner for development.

### V1. Klecks-side tests (project: `klecks-ipad`)

Device: `devices['iPad (gen 7) landscape']` → 1024 × 768, touch, mobile UA, dpr 2.

- `klecks-trigger.spec.ts`
  - **Trigger — happy path:** tap hand 6× within 5 s → overlay visible bottom-right, ~320 × 420 px, close button present.
  - **Trigger — sliding-window negative:** tap hand 6× spread over 6+ s (use `await page.waitForTimeout`) → no overlay.
  - **Trigger — other-tool-reset negative:** tap hand 5× → tap brush → tap hand → no overlay.
- `klecks-overlay.spec.ts`
  - **Send:** type "hello from klecks" → tap send → bubble right-aligned.
  - **z-index sanity:** with overlay open, open Klecks's File → New dialog → modal is above the overlay; close → overlay still visible.
  - **Keyboard focus:** focus the chat input, press `b` (brush shortcut) → no tool change.
  - **Close:** tap `×` → overlay removed, WS endpoint shows closed in `page.on('websocket', …)` trace.

### V2. Peer-side tests (project: `peer-iphone-se`)

Device: `devices['iPhone SE']` → 375 × 667, touch, mobile UA, dpr 2.

- `peer-mount.spec.ts`
  - **Auto-mount:** navigate to `/peer.html` → overlay visible, no close button, no hand-tool needed.
  - **Responsive sizing:** width within 16 px of viewport width, height within 16 px of `visualViewport.height`.
  - **Touch target sizes:** send button and "+" button both have bounding box ≥ 44 × 44 px.
  - **No double-tap zoom:** double-tap the send button → `visualViewport.scale` stays at 1.
- `peer-input.spec.ts`
  - **Text send:** type "hello from peer", tap send → bubble right-aligned.
  - **Virtual keyboard:** focus the input; assert input row's `bottom` ≤ `visualViewport.height`. Simulate keyboard via `page.evaluate(() => { window.visualViewport.dispatchEvent(new Event('resize')); })` after artificially shrinking; re-assert.
- `peer-image-upload.spec.ts`
  - **Picker → send → render (peer side):** use Playwright's `page.setInputFiles(hiddenInputSelector, 'tests/fixtures/test-image.jpg')` to bypass the iOS picker; assert a `kind: 'image'` frame is sent on the WS (use `page.on('websocket')` to capture), assert an image bubble appears right-aligned in the peer UI.
  - **Resize:** assert the outgoing frame's base64 length is much smaller than the raw `test-image.jpg` size (proves the canvas resize ran).
  - **Cancel:** call `setInputFiles(selector, [])` (no files) → no frame sent, no bubble.

### V3. Cross-device end-to-end (project: `cross-device`)

Each test constructs two contexts:

```ts
const ipadCtx  = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
const phoneCtx = await browser.newContext({ ...devices['iPhone SE'] });
```

- `cross-text.spec.ts`
  - **iPad → iPhone:** trigger overlay in iPad context, send "hi from ipad". Open `/peer.html` in phone context. Assert "hi from ipad" appears left-aligned within 2 s.
  - **iPhone → iPad:** send "hi from iphone" from phone. Assert it appears left-aligned in iPad overlay.
  - **Reload persistence (klecks):** reload iPad page, re-trigger overlay → "hi from ipad" right-aligned, "hi from iphone" left-aligned.
  - **Reload persistence (peer):** reload phone page → mirror.
- `cross-image.spec.ts`
  - **Image: peer → klecks:** from phone context, upload `test-image.jpg`. Assert the image appears right-aligned in the phone overlay (as a thumbnail) and left-aligned in the iPad overlay, and that both thumbnails actually render (`naturalWidth > 0`).
  - **Lightbox:** in either context, tap the image thumbnail. Assert the fullscreen lightbox appears (a dedicated overlay element on `document.body`). Tap the lightbox; assert it closes.
  - **No "+" button on klecks:** assert the klecks overlay does **not** render an image-attach button (UI is the sole gate; the server accepts images from either side, so the spec is verifying UI behavior only).
- `cross-restart.spec.ts`
  - Send a few text + 1 image. `docker compose restart` (via `child_process.exec` from the test). Reload both pages. Assert all prior messages still appear correctly aligned.

Each scenario is independently runnable. Selectors and fixtures are colocated in `tests/helpers/chat.ts` so per-spec churn stays small.

## Risks & open items

- **Network panel visibility:** WebSocket frames are visible in the browser's Network panel under the WS tab. This design uses WebSocket because that's what was requested, and it does keep chat traffic out of the default XHR/Fetch list, but it is not invisible to anyone inspecting the page. Image frames in particular are very large and easy to spot.
- **No rate limit + no length cap + persistent forever:** the server can be flooded by a single client and the DB grows unboundedly. Images make this much more impactful — a peer client can upload many ~300 KB images and grow `chat.db` quickly. Acceptable per the explicit request; revisit if this ever leaves a trusted environment.
- **Plaintext storage:** text messages and image bytes are both stored unencrypted in SQLite. Anyone with file access to `chat.db` can read all text history and extract all images.
- **Endpoint = identity, no auth (acknowledged):** anyone who reaches `peer.html` or who knows the URL of `/chat/peer` can pose as the peer; anyone who reaches the standalone klecks build and triggers the overlay (or who knows `/chat/klecks`) can pose as klecks. Path-based identity is convention only, not a security boundary. Both endpoints are untrusted. This is accepted as-is.
- **Image upload trust boundary:** the server validates only base64-decodability before insert/broadcast. It does **not** validate that the bytes are actually a JPEG, and (per design) does **not** restrict which side may send images — the "peer-only" property exists only because the klecks UI doesn't render the attach button. Anyone who can reach either WS endpoint can send arbitrary bytes labeled as "image" and they'll be persisted + broadcast + rendered as `<img src="data:image/jpeg;base64,…">`. Browsers ignore malformed image data (renders nothing) but server disk still grows. Same trust model as the rest of the design.
- **History payload size:** the `history` frame on connect contains up to 50 messages, each possibly carrying a ~300 KB base64 image. Worst case is a multi-megabyte frame on connect. Acceptable for in-app/local-network use; potentially slow on cellular. Mitigation if needed later: lazy-load images via a separate fetch — out of scope for v1.

## Out of scope for this spec

- Production hosting concerns beyond docker-compose: TLS termination (would be a reverse proxy in front of the container, not part of the spec), DNS, scaling, process supervision outside `docker compose`.
- Migration tooling for the SQLite schema (the spec relies on `CREATE TABLE IF NOT EXISTS`; future schema changes are a separate concern).
- Any moderation or abuse-prevention features.
- Obscuring or gating access to `peer.html` (it's served at a publicly-guessable URL on the klecks host once deployed).
- Touching `npm run build:embed` or shipping it via the container — embed remains a build target you don't deploy.
