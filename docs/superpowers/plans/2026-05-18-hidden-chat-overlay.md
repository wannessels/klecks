# Hidden Chat Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every component task ends with a commit on the `feature/hidden-chat-overlay` branch — see `superpowers:test-driven-development` (Iron Law: no production code without a failing test first).

**Goal:** Build a hidden two-sided chat (klecks-side overlay activated by 6 hand-tool taps within 5s; peer-side at `peer.html`), backed by a Node WS server with SQLite persistence, served from a single docker-compose container. Peer can attach images from the gallery; both sides render thumbnails with a fullscreen lightbox.

**Architecture:** New code in `src/app/script/klecks/easter/` (frontend), `server/` (Node service that handles both static and WS), `tests/` (Playwright Test suite with PageObjects). One docker container runs the chat server which serves `dist/` via `sirv` plus WS at `/chat/{klecks,peer}`. SQLite persists messages forever; clients receive last 50 on connect. Production deploys can flip `CHAT_STATIC_DIR=""` so the chat container handles WS only and existing nginx serves static.

**Tech Stack:** TypeScript (frontend + server), Parcel (existing), `ws` (WebSocket), `better-sqlite3`, `sirv` (static), `@playwright/test` (E2E tests with iPad / iPhone SE device profiles), docker-compose.

**Reference spec:** `docs/superpowers/specs/2026-05-18-hidden-chat-overlay-design.md`

---

## File Map

**New (frontend):**
- `src/app/script/klecks/easter/hand-click-detector.ts` — sliding-window detector
- `src/app/script/klecks/easter/chat-overlay.ts` — DOM component (overlay panel)
- `src/app/script/klecks/easter/chat-overlay.module.scss` — overlay styles
- `src/app/script/klecks/easter/chat-client.ts` — WS client wrapper with reconnect
- `src/app/script/klecks/easter/resolve-chat-url.ts` — URL helper
- `src/app/script/klecks/easter/prepare-image-for-send.ts` — canvas resize + JPEG encode
- `src/app/script/klecks/easter/image-lightbox.ts` — fullscreen viewer
- `src/app/script/klecks/easter/image-lightbox.module.scss` — lightbox styles
- `src/app/script/klecks/easter/show-chat-overlay.ts` — singleton bootstrap (klecks side)
- `src/peer.html` — peer page entry
- `src/app/script/peer-main.ts` — peer page bootstrap

**New (server):**
- `server/package.json`
- `server/tsconfig.json`
- `server/src/index.ts` — http + ws + sirv bootstrap
- `server/src/chat-room.ts` — connection set + broadcast
- `server/src/db.ts` — better-sqlite3 wrapper
- `server/src/static.ts` — sirv wiring

**New (tests):**
- `playwright.config.ts`
- `tests/pages/klecks.page.ts`
- `tests/pages/peer.page.ts`
- `tests/pages/chat-overlay.page.ts`
- `tests/pages/image-lightbox.page.ts`
- `tests/helpers/ws-capture.ts`
- `tests/helpers/docker.ts`
- `tests/fixtures/test-image.jpg`
- `tests/e2e/smoke.spec.ts`
- `tests/e2e/klecks-trigger.spec.ts`
- `tests/e2e/klecks-overlay.spec.ts`
- `tests/e2e/peer-mount.spec.ts`
- `tests/e2e/peer-input.spec.ts`
- `tests/e2e/peer-image-upload.spec.ts`
- `tests/e2e/cross-text.spec.ts`
- `tests/e2e/cross-image.spec.ts`
- `tests/e2e/cross-restart.spec.ts`

**Modify:**
- `package.json` — add scripts, devDep `@playwright/test`
- `src/app/script/app/kl-app.ts:1237` — wrap `ToolspaceToolRow.onActivate` with `HandClickDetector.record(...)`
- `src/app/script/klecks/ui/components/toolspace-tool-row.ts:341` — add `data-testid="tool-hand"` to the hand button element
- `Dockerfile` — replace `npx serve` with chat server, add `build:peer`
- `docker-compose.yml` — add named volume for SQLite

---

## Test environment assumptions

Throughout this plan, tests assume:
- **Tasks 0–6 (pre-docker):** klecks dev served by Parcel at `http://localhost:1234`. From T3 onward, the chat server runs separately at `http://localhost:8080` (with `CHAT_STATIC_DIR=` unset). Parcel build is configured with `CHAT_WS_URL=ws://localhost:8080` so the frontend reaches the chat server cross-origin.
- **Tasks 7+ (with docker):** `docker compose up -d` produces a single container at `http://localhost:5050`. `playwright.config.ts` reads `KLECKS_BASE_URL` from env (default `http://localhost:1234`) so the same specs target both environments.

Each task's test commands assume the required services are running. The plan notes which.

---

## Task 0: Bootstrap the Playwright test suite

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `tests/pages/klecks.page.ts`
- Create: `tests/e2e/smoke.spec.ts`
- Create: `.gitignore` entries for Playwright artifacts

This task introduces the test framework. No production code yet — just verify Klecks loads.

- [ ] **Step 1: Install `@playwright/test`**

```bash
npm install --save-dev @playwright/test@^1.49.0
npx playwright install chromium webkit
```

Expected: `@playwright/test` in `package.json` devDependencies; `~/.cache/ms-playwright/` populated.

- [ ] **Step 2: Add scripts to `package.json`**

In `package.json`, add to the `scripts` block (keep existing scripts as-is):

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"build:peer": "parcel build src/peer.html"
```

Also extend `start` so peer.html is also served in dev (once it exists — fine to land this now):

```json
"start": "parcel serve src/index.html src/peer.html --no-cache"
```

- [ ] **Step 3: Create `playwright.config.ts` at repo root**

```ts
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.KLECKS_BASE_URL || 'http://localhost:1234';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // shared backend state (sqlite)
    workers: 1,
    retries: 0,
    timeout: 30_000,
    use: {
        baseURL,
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
            testMatch: /cross-.*\.spec\.ts$/,
        },
        {
            name: 'smoke',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /smoke\.spec\.ts$/,
        },
    ],
});
```

- [ ] **Step 4: Append Playwright artifacts to `.gitignore`**

Append to `.gitignore`:

```
# Playwright
/test-results/
/playwright-report/
/playwright/.cache/
```

- [ ] **Step 5: Create the base `KlecksPage` PageObject**

Create `tests/pages/klecks.page.ts`:

```ts
import { Page, expect } from '@playwright/test';

export class KlecksPage {
    constructor(public readonly page: Page) {}

    async goto() {
        await this.page.goto('/');
        // Klecks shows a loading screen that removes itself when ready.
        await expect(this.page.locator('#loading-screen')).toHaveCount(0, { timeout: 15_000 });
    }

    handToolButton() {
        return this.page.getByTestId('tool-hand');
    }

    async tapHandTool() {
        await this.handToolButton().tap();
    }
}
```

- [ ] **Step 6: Write the failing smoke test**

Create `tests/e2e/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';

test('klecks loads and hand tool is targetable by data-testid', async ({ page }) => {
    const klecks = new KlecksPage(page);
    await klecks.goto();
    await expect(klecks.handToolButton()).toBeVisible();
});
```

- [ ] **Step 7: Run the smoke test and watch it fail**

Start Parcel in another terminal: `npm run start`. Then:

```bash
npm run test:e2e -- --project=smoke
```

Expected: FAIL — `getByTestId('tool-hand')` finds no element, because no `data-testid` is set yet on the hand button. This is the **right reason to fail** (production wiring missing, not test bug).

- [ ] **Step 8: Add `data-testid="tool-hand"` to the hand button**

In `src/app/script/klecks/ui/components/toolspace-tool-row.ts`, after line 351 (`this.rootEl.append(this.handButton.el);`), add:

```ts
this.handButton.el.setAttribute('data-testid', 'tool-hand');
```

- [ ] **Step 9: Run the smoke test and watch it pass**

```bash
npm run test:e2e -- --project=smoke
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/ .gitignore src/app/script/klecks/ui/components/toolspace-tool-row.ts
git commit -m "$(cat <<'EOF'
test: bootstrap Playwright test suite

Adds @playwright/test, a base playwright.config.ts with iPad / iPhone SE
device projects, the KlecksPage PageObject, and a smoke test verifying
the hand tool is targetable by data-testid. Production change: tag the
hand-tool button with data-testid="tool-hand".
EOF
)"
```

---

## Task 1: HandClickDetector with stub overlay

**Files:**
- Create: `src/app/script/klecks/easter/hand-click-detector.ts`
- Modify: `src/app/script/app/kl-app.ts` (insert at line 1237 region)
- Create: `tests/pages/chat-overlay.page.ts` (stub methods)
- Create: `tests/e2e/klecks-trigger.spec.ts`

Goal: 6 hand-tool taps within a 5-second sliding window cause an element with `data-testid="chat-overlay"` to appear in the DOM. The element is a placeholder `<div>` for now — Task 2 makes it a real overlay.

- [ ] **Step 1: Add overlay locator methods to ChatOverlayPage**

Create `tests/pages/chat-overlay.page.ts`:

```ts
import { Page } from '@playwright/test';

export class ChatOverlayPage {
    constructor(public readonly page: Page) {}

    root() {
        return this.page.getByTestId('chat-overlay');
    }

    isVisible() {
        return this.root().isVisible();
    }
}
```

- [ ] **Step 2: Write the failing trigger spec**

Create `tests/e2e/klecks-trigger.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

async function tapHand(klecks: KlecksPage, times: number, interval = 50) {
    for (let i = 0; i < times; i++) {
        await klecks.tapHandTool();
        if (i < times - 1) await klecks.page.waitForTimeout(interval);
    }
}

test('6 hand taps within 5s open the chat overlay', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();

    await tapHand(klecks, 6, 50);

    await expect(overlay.root()).toBeVisible();
});

test('6 hand taps spread over more than 5s do NOT trigger', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();

    // ~1.1s gap × 5 gaps = 5.5s total — exceeds the window
    await tapHand(klecks, 6, 1_100);

    await expect(overlay.root()).toHaveCount(0);
});

test('a non-hand tap between hand taps resets the counter', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();

    // 5 hand → 1 brush → 1 hand (= only 1 consecutive hand) — should NOT trigger
    await tapHand(klecks, 5, 50);
    await page.getByTitle(/brush/i).first().tap(); // brush tool by title — replace with data-testid if needed
    await klecks.tapHandTool();

    await expect(overlay.root()).toHaveCount(0);
});
```

- [ ] **Step 3: Run the trigger spec and watch it fail**

```bash
npm run test:e2e -- --project=klecks-ipad klecks-trigger
```

Expected: all three tests FAIL. The first fails because no `data-testid="chat-overlay"` exists. The other two pass *trivially* (no overlay ever appears) — those are weak passes but will become real once the implementation lands. The point is the **first test fails for the right reason**: no detector wired.

- [ ] **Step 4: Implement `HandClickDetector`**

Create `src/app/script/klecks/easter/hand-click-detector.ts`:

```ts
import { TToolType } from '../kl-types';

export type THandClickDetectorOptions = {
    onTrigger: () => void;
    windowMs?: number;   // default 5000
    threshold?: number;  // default 6
};

export class HandClickDetector {
    private timestamps: number[] = [];
    private readonly windowMs: number;
    private readonly threshold: number;
    private readonly onTrigger: () => void;

    constructor(opts: THandClickDetectorOptions) {
        this.onTrigger = opts.onTrigger;
        this.windowMs = opts.windowMs ?? 5000;
        this.threshold = opts.threshold ?? 6;
    }

    record(tool: TToolType) {
        if (tool !== 'hand') {
            this.timestamps = [];
            return;
        }
        const now = performance.now();
        this.timestamps.push(now);
        const cutoff = now - this.windowMs;
        this.timestamps = this.timestamps.filter((t) => t >= cutoff);
        if (this.timestamps.length >= this.threshold) {
            this.timestamps = [];
            this.onTrigger();
        }
    }
}
```

- [ ] **Step 5: Wire HandClickDetector into kl-app.ts with a stub overlay handler**

In `src/app/script/app/kl-app.ts`:

Near the top of the file (next to other `klecks/easter/` imports, or just under the existing imports block — line ~80), add:

```ts
import { HandClickDetector } from '../klecks/easter/hand-click-detector';
```

Then at line 1237, change the construction of `toolspaceToolRow` to capture the detector:

```ts
const handClickDetector = new HandClickDetector({
    onTrigger: () => {
        // Stub: append a placeholder element. Task 2 replaces this with the real overlay.
        if (document.querySelector('[data-testid="chat-overlay"]')) return;
        const el = document.createElement('div');
        el.setAttribute('data-testid', 'chat-overlay');
        el.style.cssText = 'position:fixed;bottom:8px;right:8px;width:320px;height:420px;background:#fff;z-index:9999;';
        document.body.append(el);
    },
});

this.toolspaceToolRow = new KL.ToolspaceToolRow({
    onActivate: (activeStr) => {
        handClickDetector.record(activeStr);
        // ... existing body, unchanged ...
    },
    // ... rest of options unchanged ...
});
```

The "existing body, unchanged" inside `onActivate` is the block currently at lines 1239–1266 — keep it verbatim, just prepend the `handClickDetector.record(activeStr);` line.

- [ ] **Step 6: Run the trigger spec and watch it pass**

```bash
npm run test:e2e -- --project=klecks-ipad klecks-trigger
```

Expected: all three tests PASS. The happy-path test now finds the placeholder overlay; the negative tests still don't find one (correct).

- [ ] **Step 7: Commit**

```bash
git add src/app/script/klecks/easter/hand-click-detector.ts src/app/script/app/kl-app.ts tests/pages/chat-overlay.page.ts tests/e2e/klecks-trigger.spec.ts
git commit -m "$(cat <<'EOF'
feat(easter): add HandClickDetector with 5s sliding window

Six taps of the hand tool within a 5-second sliding window now trigger
a placeholder chat overlay element. Any non-hand tool selection resets
the counter. A later commit replaces the placeholder with the real
ChatOverlay component.
EOF
)"
```

---

## Task 2: ChatOverlay skeleton (real DOM, no networking)

**Files:**
- Create: `src/app/script/klecks/easter/chat-overlay.ts`
- Create: `src/app/script/klecks/easter/chat-overlay.module.scss`
- Create: `src/app/script/klecks/easter/show-chat-overlay.ts`
- Modify: `src/app/script/app/kl-app.ts` (replace stub with showChatOverlay)
- Modify: `tests/pages/chat-overlay.page.ts` (add methods)
- Create: `tests/e2e/klecks-overlay.spec.ts`

Goal: real overlay with header, scrollable message list, input row (text input + send button), close button. Networking is stubbed — `ChatClient` is constructed but not actually opened yet (a "disconnected" no-op).

- [ ] **Step 1: Extend `ChatOverlayPage` with structural locators**

Update `tests/pages/chat-overlay.page.ts`:

```ts
import { Page, expect } from '@playwright/test';

export class ChatOverlayPage {
    constructor(public readonly page: Page) {}

    root() { return this.page.getByTestId('chat-overlay'); }
    closeButton() { return this.root().getByTestId('chat-close'); }
    input() { return this.root().getByTestId('chat-input'); }
    sendButton() { return this.root().getByTestId('chat-send'); }
    attachButton() { return this.root().getByTestId('chat-attach'); }

    isVisible() { return this.root().isVisible(); }

    async close() { await this.closeButton().tap(); }
}
```

- [ ] **Step 2: Write the failing overlay spec**

Create `tests/e2e/klecks-overlay.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

async function openOverlay(klecks: KlecksPage) {
    for (let i = 0; i < 6; i++) {
        await klecks.tapHandTool();
        await klecks.page.waitForTimeout(50);
    }
}

test('overlay shows close button and input row', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    await expect(overlay.closeButton()).toBeVisible();
    await expect(overlay.input()).toBeVisible();
    await expect(overlay.sendButton()).toBeVisible();
});

test('overlay is anchored bottom-right and roughly 320x420 on iPad', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    const box = await overlay.root().boundingBox();
    expect(box).not.toBeNull();
    const vp = page.viewportSize()!;
    expect(box!.width).toBeGreaterThanOrEqual(300);
    expect(box!.width).toBeLessThanOrEqual(360);
    expect(box!.height).toBeGreaterThanOrEqual(380);
    expect(box!.height).toBeLessThanOrEqual(460);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(vp.width - 24);
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(vp.height - 24);
});

test('tapping the close button hides the overlay', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    await overlay.close();
    await expect(overlay.root()).toHaveCount(0);
});

test('klecks side does NOT render the attach-image button', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    await expect(overlay.attachButton()).toHaveCount(0);
});
```

- [ ] **Step 3: Run the overlay spec and watch it fail**

```bash
npm run test:e2e -- --project=klecks-ipad klecks-overlay
```

Expected: FAIL on all four tests — the stub overlay has no close button, no input row, etc. Right reason.

- [ ] **Step 4: Implement the SCSS module**

Create `src/app/script/klecks/easter/chat-overlay.module.scss`:

```scss
.chatOverlay {
    position: fixed;
    bottom: max(8px, env(safe-area-inset-bottom));
    right: max(8px, env(safe-area-inset-right));
    width: 320px;
    height: 420px;
    max-width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    z-index: 1000;
    display: flex;
    flex-direction: column;
    background: #fff;
    color: #222;
    border: 1px solid #aaa;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    font-family: system-ui, sans-serif;
    overflow: hidden;
}
@media (max-width: 480px) {
    .chatOverlay {
        width: calc(100vw - 16px);
        height: calc(100dvh - 16px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    }
}
.header {
    display: flex;
    justify-content: flex-end;
    padding: 4px;
    border-bottom: 1px solid #ddd;
    flex-shrink: 0;
}
.close {
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    touch-action: manipulation;
}
.messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.bubble {
    max-width: 80%;
    padding: 6px 10px;
    border-radius: 12px;
    word-wrap: break-word;
}
.bubble.mine {
    align-self: flex-end;
    background: #d8efff;
}
.bubble.theirs {
    align-self: flex-start;
    background: #eee;
}
.inputRow {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-top: 1px solid #ddd;
    flex-shrink: 0;
}
.input {
    flex: 1;
    min-height: 44px;
    padding: 0 8px;
    border: 1px solid #ccc;
    border-radius: 4px;
    font: inherit;
}
.send, .attach {
    min-width: 44px;
    min-height: 44px;
    background: #d8efff;
    border: 1px solid #aac;
    border-radius: 4px;
    cursor: pointer;
    touch-action: manipulation;
}
```

- [ ] **Step 5: Implement `ChatOverlay`**

Create `src/app/script/klecks/easter/chat-overlay.ts`:

```ts
import styles from './chat-overlay.module.scss';

export type TChatOverlayOptions = {
    closeable: boolean;
    allowImageUpload: boolean;
    onClose?: () => void;
    onSendText?: (text: string) => void;
    onSendImage?: (base64Jpeg: string) => void;
};

export class ChatOverlay {
    private readonly rootEl: HTMLElement;
    private readonly messagesEl: HTMLElement;
    private readonly inputEl: HTMLInputElement;
    private readonly opts: TChatOverlayOptions;

    constructor(opts: TChatOverlayOptions) {
        this.opts = opts;

        this.rootEl = document.createElement('div');
        this.rootEl.className = styles.chatOverlay;
        this.rootEl.setAttribute('data-testid', 'chat-overlay');

        if (opts.closeable) {
            const header = document.createElement('div');
            header.className = styles.header;
            const close = document.createElement('button');
            close.className = styles.close;
            close.setAttribute('data-testid', 'chat-close');
            close.textContent = '×';
            close.addEventListener('click', () => this.hide());
            header.append(close);
            this.rootEl.append(header);
        }

        this.messagesEl = document.createElement('div');
        this.messagesEl.className = styles.messages;
        this.messagesEl.setAttribute('data-testid', 'chat-messages');
        this.rootEl.append(this.messagesEl);

        const row = document.createElement('div');
        row.className = styles.inputRow;

        if (opts.allowImageUpload) {
            const attach = document.createElement('button');
            attach.className = styles.attach;
            attach.setAttribute('data-testid', 'chat-attach');
            attach.textContent = '+';
            row.append(attach);
            // Wiring to file picker lands in Task 8.
        }

        this.inputEl = document.createElement('input');
        this.inputEl.type = 'text';
        this.inputEl.className = styles.input;
        this.inputEl.setAttribute('data-testid', 'chat-input');
        this.inputEl.addEventListener('keydown', (e) => {
            // Suppress propagation so Klecks's global shortcuts don't fire while typing.
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submit();
            }
        });
        this.inputEl.addEventListener('keyup', (e) => e.stopPropagation());
        row.append(this.inputEl);

        const send = document.createElement('button');
        send.className = styles.send;
        send.setAttribute('data-testid', 'chat-send');
        send.textContent = 'Send';
        send.addEventListener('click', () => this.submit());
        row.append(send);

        this.rootEl.append(row);
    }

    getElement() { return this.rootEl; }

    show() {
        if (!this.rootEl.isConnected) document.body.append(this.rootEl);
    }

    hide() {
        if (this.rootEl.isConnected) this.rootEl.remove();
        this.opts.onClose?.();
    }

    private submit() {
        const text = this.inputEl.value.trim();
        if (!text) return;
        this.opts.onSendText?.(text);
        this.inputEl.value = '';
    }
}
```

- [ ] **Step 6: Implement `show-chat-overlay.ts`**

Create `src/app/script/klecks/easter/show-chat-overlay.ts`:

```ts
import { ChatOverlay } from './chat-overlay';

let overlay: ChatOverlay | undefined;

export function showChatOverlay(): void {
    if (!overlay) {
        overlay = new ChatOverlay({
            closeable: true,
            allowImageUpload: false,
            onClose: () => { overlay = undefined; },
            // onSendText / onSendImage wired in later tasks.
        });
    }
    overlay.show();
}
```

- [ ] **Step 7: Replace the stub in `kl-app.ts`**

In `src/app/script/app/kl-app.ts`, add the import next to the HandClickDetector import:

```ts
import { showChatOverlay } from '../klecks/easter/show-chat-overlay';
```

Replace the stub `onTrigger` body added in Task 1 with:

```ts
const handClickDetector = new HandClickDetector({
    onTrigger: () => showChatOverlay(),
});
```

- [ ] **Step 8: Run both klecks specs and watch them pass**

```bash
npm run test:e2e -- --project=klecks-ipad klecks-trigger klecks-overlay
```

Expected: all tests across `klecks-trigger.spec.ts` and `klecks-overlay.spec.ts` PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/script/klecks/easter/ src/app/script/app/kl-app.ts tests/pages/chat-overlay.page.ts tests/e2e/klecks-overlay.spec.ts
git commit -m "$(cat <<'EOF'
feat(easter): real ChatOverlay component with close + input

ChatOverlay renders the panel chrome (header w/ close, scrollable
message list, text input, send button). Sized 320x420 on iPad,
responsive on phone-width viewports. Networking is still stubbed —
send is a no-op until ChatClient lands.
EOF
)"
```

---

## Task 3: Chat server bootstrap (HTTP + sirv + sqlite init, no WS yet)

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/static.ts`
- Create: `server/src/db.ts`
- Create: `server/src/index.ts`
- Create: `tests/e2e/server-bootstrap.spec.ts`

Goal: chat server starts, serves `/health`, attempts to serve `dist/` (gracefully degrades if missing). No WS handling yet — that's Task 4.

- [ ] **Step 1: Create `server/package.json`**

```json
{
    "name": "klecks-chat-server",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
        "build": "tsc",
        "start": "node --enable-source-maps dist/index.js",
        "start:dev": "tsx watch src/index.ts"
    },
    "dependencies": {
        "better-sqlite3": "^11.3.0",
        "sirv": "^2.0.4",
        "ws": "^8.18.0"
    },
    "devDependencies": {
        "@types/better-sqlite3": "^7.6.11",
        "@types/node": "^20.16.0",
        "@types/ws": "^8.5.12",
        "tsx": "^4.19.0",
        "typescript": "^5.6.0"
    }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "outDir": "dist",
        "rootDir": "src",
        "resolveJsonModule": true,
        "forceConsistentCasingInFileNames": true
    },
    "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install server deps**

```bash
cd server && npm install && cd ..
```

- [ ] **Step 4: Create `server/src/static.ts`**

```ts
import sirv from 'sirv';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type TStaticHandler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export function createStaticHandler(staticDir: string | undefined): TStaticHandler | undefined {
    if (!staticDir) {
        console.log('[static] CHAT_STATIC_DIR not set; static serving disabled.');
        return undefined;
    }
    if (!existsSync(staticDir)) {
        console.warn(`[static] CHAT_STATIC_DIR="${staticDir}" does not exist; static serving disabled.`);
        return undefined;
    }
    console.log(`[static] serving ${staticDir}`);
    return sirv(staticDir, { dev: false, single: false });
}
```

- [ ] **Step 5: Create `server/src/db.ts`**

```ts
import Database from 'better-sqlite3';

export type TSide = 'klecks' | 'peer';
export type TMessageRow =
    | { id: number; sender: TSide; kind: 'text'; text: string; createdAt: number }
    | { id: number; sender: TSide; kind: 'image'; imageData: Buffer; createdAt: number };

export class MessageStore {
    private readonly db: Database.Database;

    constructor(path: string) {
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT NOT NULL CHECK (sender IN ('klecks','peer')),
                kind TEXT NOT NULL CHECK (kind IN ('text','image')),
                text TEXT,
                image_data BLOB,
                created_at INTEGER NOT NULL,
                CHECK (
                    (kind='text'  AND text IS NOT NULL AND image_data IS NULL) OR
                    (kind='image' AND text IS NULL AND image_data IS NOT NULL)
                )
            );
            CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
        `);
    }

    insertText(sender: TSide, text: string): number {
        const r = this.db
            .prepare('INSERT INTO messages (sender, kind, text, created_at) VALUES (?, ?, ?, ?)')
            .run(sender, 'text', text, Date.now());
        return Number(r.lastInsertRowid);
    }

    insertImage(sender: TSide, imageBytes: Buffer): number {
        const r = this.db
            .prepare('INSERT INTO messages (sender, kind, image_data, created_at) VALUES (?, ?, ?, ?)')
            .run(sender, 'image', imageBytes, Date.now());
        return Number(r.lastInsertRowid);
    }

    lastN(limit = 50): TMessageRow[] {
        const rows = this.db
            .prepare('SELECT id, sender, kind, text, image_data AS imageData, created_at AS createdAt FROM messages ORDER BY created_at DESC LIMIT ?')
            .all(limit) as any[];
        return rows.reverse().map((r) =>
            r.kind === 'text'
                ? { id: r.id, sender: r.sender, kind: 'text', text: r.text, createdAt: r.createdAt }
                : { id: r.id, sender: r.sender, kind: 'image', imageData: r.imageData as Buffer, createdAt: r.createdAt },
        );
    }
}
```

- [ ] **Step 6: Create `server/src/index.ts`**

```ts
import { createServer } from 'node:http';
import { createStaticHandler } from './static.js';
import { MessageStore } from './db.js';

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.CHAT_DB_PATH ?? './chat.db';
const STATIC_DIR = process.env.CHAT_STATIC_DIR || undefined;

const store = new MessageStore(DB_PATH);
console.log(`[db] opened ${DB_PATH}`);

const staticHandler = createStaticHandler(STATIC_DIR);

const server = createServer((req, res) => {
    if (req.url === '/health') {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain');
        res.end('OK');
        return;
    }
    if (staticHandler) {
        staticHandler(req, res, () => {
            res.statusCode = 404;
            res.end('not found');
        });
        return;
    }
    res.statusCode = 404;
    res.end('not found');
});

server.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
});

export { store }; // for tests / future tasks
```

- [ ] **Step 7: Write the failing server bootstrap spec**

Create `tests/e2e/server-bootstrap.spec.ts`:

```ts
import { test, expect, request } from '@playwright/test';

const SERVER = process.env.CHAT_SERVER_URL || 'http://localhost:8080';

test('chat server /health returns 200 OK', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/health`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('OK');
    await ctx.dispose();
});

test('chat server returns 404 for unknown paths when static is disabled', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/does-not-exist`);
    expect(res.status()).toBe(404);
    await ctx.dispose();
});
```

Add a project for these tests to `playwright.config.ts` (append to the projects array):

```ts
{
    name: 'server',
    use: { ...devices['Desktop Chrome'] },
    testMatch: /server-.*\.spec\.ts$/,
},
```

- [ ] **Step 8: Run the server spec and watch it fail**

Start the chat server in another terminal:

```bash
cd server && PORT=8080 npm run start:dev
```

Then:

```bash
npm run test:e2e -- --project=server
```

Expected: PASS — the server bootstraps already. If you wrote the test first (best per TDD), the failure mode would have been "connection refused" before running the server, which is the right red. Confirm with one of those orderings.

- [ ] **Step 9: Commit**

```bash
git add server/ tests/e2e/server-bootstrap.spec.ts playwright.config.ts
git commit -m "$(cat <<'EOF'
feat(server): bootstrap node http server with static + sqlite

Adds server/ package with TypeScript build via tsc, sirv static handler
(opt-in via CHAT_STATIC_DIR), and a better-sqlite3 message store with
schema. /health returns 200; static is served when configured. No WS
handling yet — that lands in the next task.
EOF
)"
```

---

## Task 4: WebSocket infrastructure (server + client connect)

**Files:**
- Create: `server/src/chat-room.ts`
- Modify: `server/src/index.ts` (add WS upgrade)
- Create: `src/app/script/klecks/easter/resolve-chat-url.ts`
- Create: `src/app/script/klecks/easter/chat-client.ts`
- Modify: `src/app/script/klecks/easter/show-chat-overlay.ts` (instantiate client)
- Create: `tests/helpers/ws-capture.ts`
- Modify: `tests/e2e/klecks-overlay.spec.ts` (add connection assertion)

Goal: opening the chat overlay on klecks side establishes a WS connection to `/chat/klecks`. The peer endpoint exists too. No message broadcasting yet — connection only.

- [ ] **Step 1: Write the failing WS-connection spec**

Append to `tests/e2e/klecks-overlay.spec.ts`:

```ts
test('opening the overlay opens a WS to /chat/klecks', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);

    const wsUrls: string[] = [];
    page.on('websocket', (ws) => wsUrls.push(ws.url()));

    await klecks.goto();
    await openOverlay(klecks);

    await expect(overlay.root()).toBeVisible();
    await page.waitForTimeout(500); // give the client time to connect
    expect(wsUrls.some((u) => u.endsWith('/chat/klecks'))).toBe(true);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:e2e -- --project=klecks-ipad klecks-overlay
```

Expected: the new test FAILs (no WS opened — ChatClient doesn't exist yet). Right reason.

- [ ] **Step 3: Implement `chat-room.ts` on server**

Create `server/src/chat-room.ts`:

```ts
import type { WebSocket } from 'ws';
import type { TSide } from './db.js';

export type TConnection = { ws: WebSocket; side: TSide };

export class ChatRoom {
    private readonly conns = new Set<TConnection>();

    add(c: TConnection) { this.conns.add(c); }
    remove(c: TConnection) { this.conns.delete(c); }

    /** Broadcast a frame to every connection; per-connection `mine` is computed by `tag`. */
    broadcast(senderSide: TSide, tag: (recipient: TSide) => object) {
        for (const c of this.conns) {
            const frame = tag(c.side);
            try { c.ws.send(JSON.stringify(frame)); } catch { /* connection probably dying */ }
        }
    }
}
```

- [ ] **Step 4: Add WS upgrade to `server/src/index.ts`**

Replace the contents of `server/src/index.ts` with:

```ts
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createStaticHandler } from './static.js';
import { MessageStore, type TSide } from './db.js';
import { ChatRoom, type TConnection } from './chat-room.js';

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.CHAT_DB_PATH ?? './chat.db';
const STATIC_DIR = process.env.CHAT_STATIC_DIR || undefined;

const store = new MessageStore(DB_PATH);
const room = new ChatRoom();
const staticHandler = createStaticHandler(STATIC_DIR);

const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain');
        res.end('OK');
        return;
    }
    if (staticHandler) {
        staticHandler(req, res, () => {
            res.statusCode = 404;
            res.end('not found');
        });
        return;
    }
    res.statusCode = 404;
    res.end('not found');
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url ?? '';
    let side: TSide | undefined;
    if (url === '/chat/klecks') side = 'klecks';
    else if (url === '/chat/peer') side = 'peer';

    if (!side) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
    }
    const capturedSide: TSide = side;
    wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: TConnection = { ws, side: capturedSide };
        room.add(conn);
        console.log(`[ws] connect side=${capturedSide}`);

        ws.on('close', () => {
            room.remove(conn);
            console.log(`[ws] disconnect side=${capturedSide}`);
        });
        // Message handling lands in Task 5.
    });
});

httpServer.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
});
```

- [ ] **Step 5: Implement `resolve-chat-url.ts`**

Create `src/app/script/klecks/easter/resolve-chat-url.ts`:

```ts
export type TSide = 'klecks' | 'peer';

declare const process: { env: { CHAT_WS_URL?: string } } | undefined;

export function resolveChatUrl(side: TSide): string {
    const override = typeof process !== 'undefined' ? process?.env?.CHAT_WS_URL : undefined;
    if (override) return `${override.replace(/\/$/, '')}/chat/${side}`;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/chat/${side}`;
}
```

- [ ] **Step 6: Implement `chat-client.ts`**

Create `src/app/script/klecks/easter/chat-client.ts`:

```ts
export type TChatMessageBody =
    | { kind: 'text'; text: string }
    | { kind: 'image'; data: string };

export type TChatIncoming =
    | { type: 'history'; messages: (TChatMessageBody & { mine: boolean })[] }
    | ({ type: 'message'; mine: boolean } & TChatMessageBody);

export type TChatStatus = 'connected' | 'disconnected';

export type TChatClientOptions = {
    url: string;
    onMessage?: (m: TChatIncoming) => void;
    onStatus?: (s: TChatStatus) => void;
};

export class ChatClient {
    private ws: WebSocket | undefined;
    private closed = false;
    private backoffMs = 250;
    private readonly outbox: string[] = [];
    private readonly opts: TChatClientOptions;

    constructor(opts: TChatClientOptions) {
        this.opts = opts;
        this.connect();
    }

    private connect() {
        if (this.closed) return;
        const ws = new WebSocket(this.opts.url);
        this.ws = ws;
        ws.addEventListener('open', () => {
            this.backoffMs = 250;
            this.opts.onStatus?.('connected');
            while (this.outbox.length) ws.send(this.outbox.shift()!);
        });
        ws.addEventListener('message', (e) => {
            try {
                const msg = JSON.parse(typeof e.data === 'string' ? e.data : '') as TChatIncoming;
                this.opts.onMessage?.(msg);
            } catch { /* ignore malformed */ }
        });
        ws.addEventListener('close', () => {
            this.opts.onStatus?.('disconnected');
            if (this.closed) return;
            const wait = Math.min(this.backoffMs, 30_000);
            this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
            setTimeout(() => this.connect(), wait);
        });
        ws.addEventListener('error', () => { /* let close handle reconnect */ });
    }

    private sendRaw(payload: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(payload);
        else this.outbox.push(payload);
    }

    sendText(text: string) {
        this.sendRaw(JSON.stringify({ type: 'send', kind: 'text', text }));
    }

    sendImage(base64Jpeg: string) {
        this.sendRaw(JSON.stringify({ type: 'send', kind: 'image', data: base64Jpeg }));
    }

    close() {
        this.closed = true;
        this.ws?.close();
    }
}
```

- [ ] **Step 7: Wire ChatClient into `show-chat-overlay.ts`**

Replace `src/app/script/klecks/easter/show-chat-overlay.ts` with:

```ts
import { ChatOverlay } from './chat-overlay';
import { ChatClient } from './chat-client';
import { resolveChatUrl } from './resolve-chat-url';

let overlay: ChatOverlay | undefined;
let client: ChatClient | undefined;

export function showChatOverlay(): void {
    if (!overlay) {
        client = new ChatClient({ url: resolveChatUrl('klecks') });
        overlay = new ChatOverlay({
            closeable: true,
            allowImageUpload: false,
            onClose: () => {
                client?.close();
                client = undefined;
                overlay = undefined;
            },
            onSendText: (t) => client?.sendText(t),
        });
    }
    overlay.show();
}
```

- [ ] **Step 8: Set parcel build env so klecks dev reaches localhost:8080**

In `package.json`, change the `start` script to set the env var before parcel:

```json
"start": "cross-env CHAT_WS_URL=ws://localhost:8080 parcel serve src/index.html src/peer.html --no-cache"
```

Install the helper:

```bash
npm install --save-dev cross-env
```

Note: parcel's `process.env.CHAT_WS_URL` is replaced at build time when referenced as `process.env.X` in source. The `resolve-chat-url.ts` helper already does this via the typed `declare const process`. Restart Parcel after this change.

- [ ] **Step 9: Run klecks-overlay and watch the new test pass**

With Parcel restarted and the chat server running:

```bash
npm run test:e2e -- --project=klecks-ipad klecks-overlay
```

Expected: all overlay tests PASS, including the new "opens a WS to /chat/klecks" assertion.

- [ ] **Step 10: Commit**

```bash
git add server/ src/app/script/klecks/easter/ tests/e2e/klecks-overlay.spec.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat: WS infrastructure for chat (server + client connect)

Server: WebSocketServer mounted on the http server, accepting upgrades
on /chat/klecks and /chat/peer (path → side). Connections are tracked
in an in-memory ChatRoom; message handling is still TODO.

Client: ChatClient handles connect, reconnect with exponential backoff,
and a buffered outbox. resolveChatUrl picks ws/wss + /chat/<side> from
window.location, with CHAT_WS_URL build override for cross-origin dev.

show-chat-overlay now instantiates a client on first trigger and closes
it on overlay close. dev script sets CHAT_WS_URL via cross-env.
EOF
)"
```

---

## Task 5: Text round-trip (single-side echo)

**Files:**
- Modify: `server/src/index.ts` (handle incoming 'send' frames)
- Modify: `src/app/script/klecks/easter/chat-overlay.ts` (render bubbles from incoming frames)
- Modify: `src/app/script/klecks/easter/show-chat-overlay.ts` (pass overlay.onIncoming callback)
- Create: `tests/e2e/klecks-overlay.spec.ts` additional test cases (text send)

Goal: typing in the klecks overlay and clicking send results in a right-aligned bubble appearing in the same overlay (round-trip via server, single side).

- [ ] **Step 1: Write the failing text-round-trip test**

Append to `tests/e2e/klecks-overlay.spec.ts`:

```ts
test('typing + send produces a sent-bubble via server round-trip', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    const stamp = `klecks-${Date.now()}`;
    await overlay.input().fill(`hello ${stamp}`);
    await overlay.sendButton().tap();

    const myBubble = overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: `hello ${stamp}` });
    await expect(myBubble).toBeVisible();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:e2e -- --project=klecks-ipad klecks-overlay
```

Expected: FAIL — no bubble is rendered (server doesn't echo yet; ChatOverlay doesn't know how to render).

- [ ] **Step 3: Handle incoming frames on the server**

Replace the body of the `wss.handleUpgrade(...)` callback in `server/src/index.ts` with:

```ts
wss.handleUpgrade(req, socket, head, (ws) => {
    const conn: TConnection = { ws, side: capturedSide };
    room.add(conn);
    console.log(`[ws] connect side=${capturedSide}`);

    ws.on('message', (data) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (!msg || msg.type !== 'send') return;
        if (msg.kind === 'text' && typeof msg.text === 'string') {
            const text = msg.text.trim();
            if (!text) return;
            store.insertText(capturedSide, text);
            room.broadcast(capturedSide, (recipient) => ({
                type: 'message',
                kind: 'text',
                text,
                mine: recipient === capturedSide,
            }));
        }
        // image branch lands in Task 8.
    });

    ws.on('close', () => {
        room.remove(conn);
        console.log(`[ws] disconnect side=${capturedSide}`);
    });
});
```

- [ ] **Step 4: Add bubble rendering to ChatOverlay**

In `src/app/script/klecks/easter/chat-overlay.ts`, extend the class with a public `renderIncoming` method and a private `appendBubble`:

```ts
// Inside the ChatOverlay class, alongside getElement():

renderIncoming(msg: { kind: 'text'; text: string; mine: boolean } | { kind: 'image'; data: string; mine: boolean }) {
    if (msg.kind === 'text') this.appendTextBubble(msg.text, msg.mine);
    // image branch lands in Task 8.
}

private appendTextBubble(text: string, mine: boolean) {
    const el = document.createElement('div');
    el.className = `${styles.bubble} ${mine ? styles.mine : styles.theirs}`;
    el.setAttribute('data-testid', mine ? 'chat-bubble-mine' : 'chat-bubble-theirs');
    el.textContent = text;
    this.messagesEl.append(el);
    this.scrollToBottomIfNotPinned();
}

private scrollToBottomIfNotPinned() {
    // Simple version: always pin to bottom for now. Refined later if needed.
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
}
```

- [ ] **Step 5: Wire ChatOverlay to receive frames from ChatClient**

Update `src/app/script/klecks/easter/show-chat-overlay.ts`:

```ts
import { ChatOverlay } from './chat-overlay';
import { ChatClient } from './chat-client';
import { resolveChatUrl } from './resolve-chat-url';

let overlay: ChatOverlay | undefined;
let client: ChatClient | undefined;

export function showChatOverlay(): void {
    if (!overlay) {
        const localOverlay = new ChatOverlay({
            closeable: true,
            allowImageUpload: false,
            onClose: () => {
                client?.close();
                client = undefined;
                overlay = undefined;
            },
            onSendText: (t) => client?.sendText(t),
        });
        const localClient = new ChatClient({
            url: resolveChatUrl('klecks'),
            onMessage: (m) => {
                if (m.type === 'message') localOverlay.renderIncoming(m);
                else if (m.type === 'history') for (const e of m.messages) localOverlay.renderIncoming({ ...e, mine: e.mine });
            },
        });
        overlay = localOverlay;
        client = localClient;
    }
    overlay.show();
}
```

- [ ] **Step 6: Run and watch it pass**

```bash
npm run test:e2e -- --project=klecks-ipad klecks-overlay
```

Expected: all overlay tests PASS, including the new round-trip.

- [ ] **Step 7: Commit**

```bash
git add src/app/script/klecks/easter/ server/src/index.ts tests/e2e/klecks-overlay.spec.ts
git commit -m "$(cat <<'EOF'
feat: text round-trip via WS, rendered as bubbles

Server now handles 'send' frames of kind='text', inserts the message,
and broadcasts back to every connection with a per-recipient `mine`
flag. ChatOverlay renders incoming text frames as right- or
left-aligned bubbles with data-testid="chat-bubble-{mine|theirs}".
EOF
)"
```

---

## Task 6: Peer page + cross-side text broadcast

**Files:**
- Create: `src/peer.html`
- Create: `src/app/script/peer-main.ts`
- Create: `tests/pages/peer.page.ts`
- Create: `tests/e2e/peer-mount.spec.ts`
- Create: `tests/e2e/peer-input.spec.ts`
- Create: `tests/e2e/cross-text.spec.ts`

Goal: the peer at `/peer.html` mounts the chat overlay with `closeable: false, allowImageUpload: true`. Text sent from either side reaches the other.

- [ ] **Step 1: Write the failing peer mount spec**

Create `tests/pages/peer.page.ts`:

```ts
import { Page, expect } from '@playwright/test';

export class PeerPage {
    constructor(public readonly page: Page) {}

    async goto() {
        await this.page.goto('/peer.html');
    }
}
```

Create `tests/e2e/peer-mount.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

test('peer.html shows the chat overlay immediately, no close button', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();
    await expect(overlay.root()).toBeVisible();
    await expect(overlay.closeButton()).toHaveCount(0);
});

test('peer.html renders the attach-image button', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();
    await expect(overlay.attachButton()).toBeVisible();
});

test('peer overlay fills the iPhone SE viewport', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();
    const box = await overlay.root().boundingBox();
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(vp.width - 16);
    expect(box!.height).toBeGreaterThanOrEqual(vp.height - 80); // some allowance for safe-area
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:e2e -- --project=peer-iphone-se
```

Expected: FAIL — `/peer.html` 404s. Right reason.

- [ ] **Step 3: Create `src/peer.html`**

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <title>Chat</title>
        <base href="/" />
        <meta
            name="viewport"
            content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="color-scheme" content="dark light" />
        <style>
            html, body { margin: 0; padding: 0; height: 100%; background: #999; }
        </style>
    </head>
    <body>
        <script type="module" src="app/script/peer-main.ts"></script>
    </body>
</html>
```

- [ ] **Step 4: Create `src/app/script/peer-main.ts`**

```ts
import { ChatOverlay } from './klecks/easter/chat-overlay';
import { ChatClient } from './klecks/easter/chat-client';
import { resolveChatUrl } from './klecks/easter/resolve-chat-url';

const overlay = new ChatOverlay({
    closeable: false,
    allowImageUpload: true,
    onSendText: (t) => client.sendText(t),
});
const client = new ChatClient({
    url: resolveChatUrl('peer'),
    onMessage: (m) => {
        if (m.type === 'message') overlay.renderIncoming(m);
        else if (m.type === 'history') for (const e of m.messages) overlay.renderIncoming({ ...e, mine: e.mine });
    },
});
overlay.show();
```

- [ ] **Step 5: Run peer-mount tests and watch them pass**

Restart Parcel (`npm run start`) so it picks up `src/peer.html`. Then:

```bash
npm run test:e2e -- --project=peer-iphone-se peer-mount
```

Expected: PASS.

- [ ] **Step 6: Write the failing peer-input test**

Create `tests/e2e/peer-input.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

test('peer can send a text message and see its own bubble', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();

    const stamp = `peer-${Date.now()}`;
    await overlay.input().fill(`hi ${stamp}`);
    await overlay.sendButton().tap();

    const myBubble = overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: `hi ${stamp}` });
    await expect(myBubble).toBeVisible();
});
```

- [ ] **Step 7: Run and watch it pass**

```bash
npm run test:e2e -- --project=peer-iphone-se peer-input
```

Expected: PASS (the round-trip already works server-side).

- [ ] **Step 8: Write the failing cross-text spec**

Create `tests/e2e/cross-text.spec.ts`:

```ts
import { test, expect, devices } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

async function openKlecksOverlay(klecks: KlecksPage) {
    for (let i = 0; i < 6; i++) {
        await klecks.tapHandTool();
        await klecks.page.waitForTimeout(50);
    }
}

test('text travels from klecks (iPad) to peer (iPhone)', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const ipadPage = await ipad.newPage();
    const phonePage = await phone.newPage();

    const klecks = new KlecksPage(ipadPage);
    const peer = new PeerPage(phonePage);
    const klecksOverlay = new ChatOverlayPage(ipadPage);
    const peerOverlay = new ChatOverlayPage(phonePage);

    await klecks.goto();
    await peer.goto();
    await openKlecksOverlay(klecks);

    const stamp = `i2p-${Date.now()}`;
    await klecksOverlay.input().fill(`hi from ipad ${stamp}`);
    await klecksOverlay.sendButton().tap();

    await expect(peerOverlay.root().getByTestId('chat-bubble-theirs').filter({ hasText: stamp })).toBeVisible({ timeout: 5_000 });
    await ipad.close();
    await phone.close();
});

test('text travels from peer (iPhone) to klecks (iPad)', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const ipadPage = await ipad.newPage();
    const phonePage = await phone.newPage();

    const klecks = new KlecksPage(ipadPage);
    const peer = new PeerPage(phonePage);
    const klecksOverlay = new ChatOverlayPage(ipadPage);
    const peerOverlay = new ChatOverlayPage(phonePage);

    await klecks.goto();
    await peer.goto();
    await openKlecksOverlay(klecks);

    const stamp = `p2i-${Date.now()}`;
    await peerOverlay.input().fill(`hi from iphone ${stamp}`);
    await peerOverlay.sendButton().tap();

    await expect(klecksOverlay.root().getByTestId('chat-bubble-theirs').filter({ hasText: stamp })).toBeVisible({ timeout: 5_000 });
    await ipad.close();
    await phone.close();
});
```

- [ ] **Step 9: Run cross-text and watch it pass**

```bash
npm run test:e2e -- --project=cross-device cross-text
```

Expected: PASS — broadcast already works because the server hits every connection regardless of side.

- [ ] **Step 10: Commit**

```bash
git add src/peer.html src/app/script/peer-main.ts tests/pages/peer.page.ts tests/e2e/peer-mount.spec.ts tests/e2e/peer-input.spec.ts tests/e2e/cross-text.spec.ts
git commit -m "$(cat <<'EOF'
feat: peer.html entry + cross-side text broadcast

New parcel entry src/peer.html that bootstraps the same ChatOverlay
with closeable: false, allowImageUpload: true. Server broadcasts text
messages to every connection on either endpoint, so klecks ↔ peer chat
works once both pages are open.
EOF
)"
```

---

## Task 7: SQLite persistence — history on connect

**Files:**
- Modify: `server/src/index.ts` (send history on connect)
- Modify: `src/app/script/klecks/easter/chat-overlay.ts` (already handles incoming, but expose a `clear()` for reload tests — see step)
- Add tests to `tests/e2e/cross-text.spec.ts`

Goal: when a client connects, the server sends the last 50 messages as a `history` frame; client renders them with correct `mine` flags. After a reload, prior messages survive.

- [ ] **Step 1: Write the failing reload-persistence test**

Append to `tests/e2e/cross-text.spec.ts`:

```ts
test('after reload, klecks sees its prior sent messages right-aligned', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const ipadPage = await ipad.newPage();
    const klecks = new KlecksPage(ipadPage);
    const overlay = new ChatOverlayPage(ipadPage);

    await klecks.goto();
    await openKlecksOverlay(klecks);

    const stamp = `reload-${Date.now()}`;
    await overlay.input().fill(`persistent ${stamp}`);
    await overlay.sendButton().tap();
    await expect(overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: stamp })).toBeVisible();

    // Reload and reopen the overlay.
    await ipadPage.reload();
    await klecks.goto(); // re-runs the loading-screen wait
    await openKlecksOverlay(klecks);

    await expect(overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: stamp })).toBeVisible({ timeout: 5_000 });
    await ipad.close();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:e2e -- --project=cross-device cross-text
```

Expected: the new test FAILs — after reload, the overlay is empty (no history sent yet).

- [ ] **Step 3: Send history on connect**

Inside `wss.handleUpgrade(...)`'s callback in `server/src/index.ts`, after `room.add(conn)` and before `ws.on('message', ...)`, insert:

```ts
const history = store.lastN(50).map((row) => {
    const mine = row.sender === capturedSide;
    return row.kind === 'text'
        ? { kind: 'text' as const, text: row.text, mine }
        : { kind: 'image' as const, data: row.imageData.toString('base64'), mine };
});
ws.send(JSON.stringify({ type: 'history', messages: history }));
```

- [ ] **Step 4: Run and watch it pass**

```bash
npm run test:e2e -- --project=cross-device cross-text
```

Expected: PASS, including the new reload test.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts tests/e2e/cross-text.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): send last 50 messages as history on WS connect

After a client reconnects (or a tab reloads), the server emits a
'history' frame containing up to 50 prior messages, each tagged with
mine = (sender === connection.side). This preserves sent/received
alignment across reloads since identity is endpoint-derived.
EOF
)"
```

---

## Task 8: Image upload from the peer side

**Files:**
- Create: `src/app/script/klecks/easter/prepare-image-for-send.ts`
- Modify: `src/app/script/klecks/easter/chat-overlay.ts` (wire attach button + render image bubbles)
- Modify: `server/src/index.ts` (handle 'send' kind='image')
- Create: `tests/fixtures/test-image.jpg`
- Create: `tests/e2e/peer-image-upload.spec.ts`

Goal: peer taps "+", picks an image, the image is resized client-side, sent via WS, persisted, broadcast, and rendered as a thumbnail bubble on both sides.

- [ ] **Step 1: Add a test fixture**

Generate a ~2 MB JPEG (any photo). Place it at `tests/fixtures/test-image.jpg`. You can use ImageMagick or any tool:

```bash
# Optional: generate a synthetic test JPEG, ~2 MB.
# (Skip if you have an existing JPEG to drop in.)
npx -y @napi-rs/canvas-cli generate --width 4000 --height 3000 --color red --out tests/fixtures/test-image.jpg
# Verify
ls -la tests/fixtures/test-image.jpg
```

If the `npx` line isn't convenient, hand-place any photo named `test-image.jpg` of at least 1.5 MB.

- [ ] **Step 2: Write the failing image-upload spec**

Create `tests/e2e/peer-image-upload.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';
import * as path from 'node:path';

test('peer can attach an image; thumbnail appears as a sent bubble', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();

    // setInputFiles bypasses the iOS picker — files the underlying <input type=file>.
    const fileInput = overlay.root().locator('input[type=file]');
    await fileInput.setInputFiles(path.resolve('tests/fixtures/test-image.jpg'));

    const imgBubble = overlay.root().getByTestId('chat-bubble-mine').locator('img');
    await expect(imgBubble).toBeVisible({ timeout: 8_000 });

    // Resize sanity: outgoing payload should be much smaller than the source.
    const naturalWidth = await imgBubble.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
    expect(naturalWidth).toBeLessThanOrEqual(1024);
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
npm run test:e2e -- --project=peer-iphone-se peer-image-upload
```

Expected: FAIL — no `<input type=file>` exists; the attach button isn't wired.

- [ ] **Step 4: Implement `prepare-image-for-send.ts`**

```ts
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.8;

export async function prepareImageForSend(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('image decode failed'));
            el.src = url;
        });
        const ratio = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * ratio);
        const h = Math.round(img.naturalHeight * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d unavailable');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        const i = dataUrl.indexOf(',');
        if (i < 0) throw new Error('toDataURL malformed');
        return dataUrl.slice(i + 1);
    } finally {
        URL.revokeObjectURL(url);
    }
}
```

- [ ] **Step 5: Wire the attach button + image bubbles in `chat-overlay.ts`**

In `chat-overlay.ts`, replace the `if (opts.allowImageUpload)` block with:

```ts
let attachInput: HTMLInputElement | undefined;
if (opts.allowImageUpload) {
    const attach = document.createElement('button');
    attach.className = styles.attach;
    attach.setAttribute('data-testid', 'chat-attach');
    attach.textContent = '+';
    attachInput = document.createElement('input');
    attachInput.type = 'file';
    attachInput.accept = 'image/*';
    attachInput.style.display = 'none';
    attachInput.setAttribute('data-testid', 'chat-attach-input');
    attach.addEventListener('click', () => attachInput!.click());
    attachInput.addEventListener('change', async () => {
        const f = attachInput!.files?.[0];
        attachInput!.value = '';
        if (!f) return;
        try {
            const { prepareImageForSend } = await import('./prepare-image-for-send');
            const base64 = await prepareImageForSend(f);
            this.opts.onSendImage?.(base64);
        } catch (e) {
            console.error('[chat] image prep failed', e);
        }
    });
    row.append(attach);
    row.append(attachInput);
}
```

Add the image-bubble rendering helper to the class:

```ts
private appendImageBubble(base64: string, mine: boolean) {
    const wrap = document.createElement('div');
    wrap.className = `${styles.bubble} ${mine ? styles.mine : styles.theirs}`;
    wrap.setAttribute('data-testid', mine ? 'chat-bubble-mine' : 'chat-bubble-theirs');
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${base64}`;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '240px';
    img.style.cursor = 'pointer';
    img.setAttribute('data-testid', 'chat-image-thumb');
    // Lightbox wiring lands in Task 9.
    wrap.append(img);
    this.messagesEl.append(wrap);
    this.scrollToBottomIfNotPinned();
}
```

Extend `renderIncoming`:

```ts
renderIncoming(msg: { kind: 'text'; text: string; mine: boolean } | { kind: 'image'; data: string; mine: boolean }) {
    if (msg.kind === 'text') this.appendTextBubble(msg.text, msg.mine);
    else this.appendImageBubble(msg.data, msg.mine);
}
```

And ensure the `submit()` path also wires `onSendImage` consumers — but image sending goes through the attach handler, not `submit()`, so no change needed there.

- [ ] **Step 6: Wire `onSendImage` in `peer-main.ts`**

Update the `ChatOverlay` construction in `src/app/script/peer-main.ts`:

```ts
const overlay = new ChatOverlay({
    closeable: false,
    allowImageUpload: true,
    onSendText: (t) => client.sendText(t),
    onSendImage: (b) => client.sendImage(b),
});
```

- [ ] **Step 7: Handle image frames on the server**

In `server/src/index.ts`, inside `ws.on('message', ...)`, after the text branch, add:

```ts
if (msg.kind === 'image' && typeof msg.data === 'string') {
    let bytes: Buffer;
    try {
        bytes = Buffer.from(msg.data, 'base64');
    } catch { return; }
    if (bytes.length === 0) return;
    store.insertImage(capturedSide, bytes);
    room.broadcast(capturedSide, (recipient) => ({
        type: 'message',
        kind: 'image',
        data: bytes.toString('base64'),
        mine: recipient === capturedSide,
    }));
}
```

- [ ] **Step 8: Run and watch it pass**

```bash
npm run test:e2e -- --project=peer-iphone-se peer-image-upload
```

Expected: PASS — thumbnail appears, `naturalWidth ≤ 1024`.

- [ ] **Step 9: Commit**

```bash
git add src/app/script/klecks/easter/ src/app/script/peer-main.ts server/src/index.ts tests/fixtures/test-image.jpg tests/e2e/peer-image-upload.spec.ts
git commit -m "$(cat <<'EOF'
feat: peer-side image upload (resize → WS → thumbnail)

Peer overlay gains a "+" button wired to a hidden file input. Selected
images are decoded, downscaled to max 1024px long edge as JPEG q=0.8
on canvas, base64-encoded, and sent over the same WS as text frames
with kind="image". Server persists the raw bytes in SQLite and
broadcasts to both sides with re-encoded base64. Thumbnails render in
bubbles at max-height 240px.
EOF
)"
```

---

## Task 9: Image lightbox

**Files:**
- Create: `src/app/script/klecks/easter/image-lightbox.ts`
- Create: `src/app/script/klecks/easter/image-lightbox.module.scss`
- Modify: `src/app/script/klecks/easter/chat-overlay.ts` (open lightbox on thumb tap)
- Create: `tests/pages/image-lightbox.page.ts`
- Create: `tests/e2e/cross-image.spec.ts`

Goal: tapping/clicking an image thumbnail opens a fullscreen lightbox showing the image; tap anywhere on the lightbox or press Esc to close it.

- [ ] **Step 1: Write the failing lightbox test**

Create `tests/pages/image-lightbox.page.ts`:

```ts
import { Page } from '@playwright/test';

export class ImageLightboxPage {
    constructor(public readonly page: Page) {}
    root() { return this.page.getByTestId('image-lightbox'); }
    image() { return this.root().locator('img'); }
    isVisible() { return this.root().isVisible(); }
    async close() { await this.root().tap(); }
}
```

Create `tests/e2e/cross-image.spec.ts`:

```ts
import { test, expect, devices } from '@playwright/test';
import { PeerPage } from '../pages/peer.page';
import { KlecksPage } from '../pages/klecks.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';
import { ImageLightboxPage } from '../pages/image-lightbox.page';
import * as path from 'node:path';

async function openKlecksOverlay(klecks: KlecksPage) {
    for (let i = 0; i < 6; i++) {
        await klecks.tapHandTool();
        await klecks.page.waitForTimeout(50);
    }
}

test('image sent from peer reaches klecks as a left-aligned thumbnail', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const ipadPage = await ipad.newPage();
    const phonePage = await phone.newPage();

    const klecks = new KlecksPage(ipadPage);
    const peer = new PeerPage(phonePage);
    const klecksOverlay = new ChatOverlayPage(ipadPage);
    const peerOverlay = new ChatOverlayPage(phonePage);

    await klecks.goto();
    await peer.goto();
    await openKlecksOverlay(klecks);

    await peerOverlay.root().locator('input[type=file]').setInputFiles(path.resolve('tests/fixtures/test-image.jpg'));

    const theirs = klecksOverlay.root().getByTestId('chat-bubble-theirs').locator('img').last();
    await expect(theirs).toBeVisible({ timeout: 8_000 });
    expect(await theirs.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    await ipad.close();
    await phone.close();
});

test('tapping a thumbnail opens the fullscreen lightbox; tapping it closes', async ({ browser }) => {
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const phonePage = await phone.newPage();
    const peer = new PeerPage(phonePage);
    const peerOverlay = new ChatOverlayPage(phonePage);
    const lightbox = new ImageLightboxPage(phonePage);

    await peer.goto();
    await peerOverlay.root().locator('input[type=file]').setInputFiles(path.resolve('tests/fixtures/test-image.jpg'));
    const thumb = peerOverlay.root().getByTestId('chat-image-thumb').last();
    await expect(thumb).toBeVisible({ timeout: 8_000 });
    await thumb.tap();

    await expect(lightbox.root()).toBeVisible();
    await lightbox.close();
    await expect(lightbox.root()).toHaveCount(0);

    await phone.close();
});

test('klecks side has no attach-image button', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const ipadPage = await ipad.newPage();
    const klecks = new KlecksPage(ipadPage);
    const klecksOverlay = new ChatOverlayPage(ipadPage);

    await klecks.goto();
    await openKlecksOverlay(klecks);
    await expect(klecksOverlay.attachButton()).toHaveCount(0);

    await ipad.close();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npm run test:e2e -- --project=cross-device cross-image
```

Expected: the lightbox test FAILs (no `data-testid="image-lightbox"` element). The other two tests likely already pass (built on prior tasks).

- [ ] **Step 3: Implement `image-lightbox.module.scss`**

```scss
.backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    cursor: pointer;
    touch-action: manipulation;
}
.image {
    max-width: 100vw;
    max-height: 100dvh;
    object-fit: contain;
}
```

- [ ] **Step 4: Implement `image-lightbox.ts`**

```ts
import styles from './image-lightbox.module.scss';

export function openImageLightbox(base64Jpeg: string): void {
    if (document.querySelector('[data-testid="image-lightbox"]')) return;
    const root = document.createElement('div');
    root.className = styles.backdrop;
    root.setAttribute('data-testid', 'image-lightbox');
    const img = document.createElement('img');
    img.className = styles.image;
    img.src = `data:image/jpeg;base64,${base64Jpeg}`;
    root.append(img);
    const close = () => {
        root.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    root.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(root);
}
```

- [ ] **Step 5: Wire the lightbox into ChatOverlay's image bubbles**

In `chat-overlay.ts`, update `appendImageBubble`:

```ts
private appendImageBubble(base64: string, mine: boolean) {
    const wrap = document.createElement('div');
    wrap.className = `${styles.bubble} ${mine ? styles.mine : styles.theirs}`;
    wrap.setAttribute('data-testid', mine ? 'chat-bubble-mine' : 'chat-bubble-theirs');
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${base64}`;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '240px';
    img.style.cursor = 'pointer';
    img.setAttribute('data-testid', 'chat-image-thumb');
    img.addEventListener('click', async () => {
        const { openImageLightbox } = await import('./image-lightbox');
        openImageLightbox(base64);
    });
    wrap.append(img);
    this.messagesEl.append(wrap);
    this.scrollToBottomIfNotPinned();
}
```

- [ ] **Step 6: Run and watch it pass**

```bash
npm run test:e2e -- --project=cross-device cross-image
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/script/klecks/easter/image-lightbox.ts src/app/script/klecks/easter/image-lightbox.module.scss src/app/script/klecks/easter/chat-overlay.ts tests/pages/image-lightbox.page.ts tests/e2e/cross-image.spec.ts
git commit -m "$(cat <<'EOF'
feat: image lightbox on thumbnail tap

Tapping an image thumbnail in any chat bubble opens a fullscreen
lightbox (sibling of the overlay on document.body, z-index above
modals). Tap or Esc closes it.
EOF
)"
```

---

## Task 10: Docker integration (single-container deploy)

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Create: `tests/helpers/docker.ts`
- Create: `tests/e2e/cross-restart.spec.ts`

Goal: `docker compose up -d` produces a working stack at `http://localhost:5050`. SQLite persists across `docker compose restart`.

- [ ] **Step 1: Update the `Dockerfile`**

Replace the existing `Dockerfile` with:

```Dockerfile
FROM node:20

WORKDIR /var/www
COPY . /var/www

# Frontend builds
RUN npm ci
RUN npm run lang:build
RUN npm run build
RUN npm run build:peer
RUN npm run build:help

# Server build
WORKDIR /var/www/server
RUN npm ci
RUN npm run build

# Runtime
ENV PORT=3000
ENV CHAT_DB_PATH=/var/www/chat-data/chat.db
ENV CHAT_STATIC_DIR=/var/www/dist
RUN mkdir -p /var/www/chat-data
EXPOSE 3000
ENTRYPOINT ["npm", "run", "start"]
```

- [ ] **Step 2: Update `docker-compose.yml`**

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

- [ ] **Step 3: Build and start the container**

```bash
docker compose build
docker compose up -d
curl -s http://localhost:5050/health
```

Expected: `OK`. Also `curl -s http://localhost:5050/` returns Klecks HTML; `curl -s http://localhost:5050/peer.html` returns the peer HTML.

- [ ] **Step 4: Add the docker helper**

Create `tests/helpers/docker.ts`:

```ts
import { execFileSync } from 'node:child_process';

export function dockerComposeRestart() {
    execFileSync('docker', ['compose', 'restart'], { stdio: 'inherit' });
}
```

- [ ] **Step 5: Write the failing restart-persistence test**

Create `tests/e2e/cross-restart.spec.ts`:

```ts
import { test, expect, devices } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';
import { dockerComposeRestart } from '../helpers/docker';
import * as path from 'node:path';

test('history survives docker compose restart', async ({ browser }) => {
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const phonePage = await phone.newPage();
    const peer = new PeerPage(phonePage);
    const overlay = new ChatOverlayPage(phonePage);

    await peer.goto();
    const stamp = `restart-${Date.now()}`;
    await overlay.input().fill(`survive ${stamp}`);
    await overlay.sendButton().tap();
    await expect(overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: stamp })).toBeVisible();

    // Drop image too
    await overlay.root().locator('input[type=file]').setInputFiles(path.resolve('tests/fixtures/test-image.jpg'));
    await expect(overlay.root().getByTestId('chat-bubble-mine').locator('img').last()).toBeVisible({ timeout: 8_000 });

    await phone.close();
    dockerComposeRestart();
    // Give the container a moment to settle.
    await new Promise((r) => setTimeout(r, 3000));

    const phone2 = await browser.newContext({ ...devices['iPhone SE'] });
    const phonePage2 = await phone2.newPage();
    const peer2 = new PeerPage(phonePage2);
    const overlay2 = new ChatOverlayPage(phonePage2);
    await peer2.goto();
    await expect(overlay2.root().getByTestId('chat-bubble-mine').filter({ hasText: stamp })).toBeVisible({ timeout: 8_000 });
    await expect(overlay2.root().getByTestId('chat-bubble-mine').locator('img').last()).toBeVisible({ timeout: 8_000 });
    await phone2.close();
});
```

- [ ] **Step 6: Run all tests against docker**

```bash
KLECKS_BASE_URL=http://localhost:5050 npm run test:e2e
```

Expected: every spec passes. The restart test specifically demonstrates SQLite + volume persistence.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile docker-compose.yml tests/helpers/docker.ts tests/e2e/cross-restart.spec.ts
git commit -m "$(cat <<'EOF'
feat(deploy): single-container docker-compose with chat-data volume

The Dockerfile now builds the parcel artifacts (standalone, peer, help),
builds the chat server, and runs it as the entrypoint. The server
serves dist/ via sirv and handles WS at /chat/{klecks,peer}. SQLite
lives in /var/www/chat-data, mounted from a named volume so messages
survive container recreation. docker compose up -d → reachable at
http://localhost:5050.
EOF
)"
```

---

## Final verification

Once all tasks are committed, run the full suite end-to-end against the docker deploy:

```bash
docker compose up -d
KLECKS_BASE_URL=http://localhost:5050 npm run test:e2e
```

Every project (`smoke`, `klecks-ipad`, `peer-iphone-se`, `cross-device`, `server`) should pass. The branch is then ready for review / merge.
