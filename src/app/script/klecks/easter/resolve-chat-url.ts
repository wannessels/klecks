export type TSide = 'klecks' | 'peer';

// Order of precedence when picking the WS endpoint:
//   1. `window.__CHAT_WS_URL__` — runtime override the harness / tests / a
//      hosting page can drop in before the bundle runs.
//   2. Parcel dev server (port 1234) — the chat server runs on :8080 in dev,
//      so we redirect across ports. This keeps the dev story trivial: just
//      run `npm run start` + the chat server, no extra wiring needed.
//   3. Same origin as the page — production deployment where one reverse
//      proxy serves static + /chat/* on the same host:port.
//
// We deliberately do NOT read `process.env.X` here. Parcel only inlines that
// pattern when it transforms the file, which is unreliable from a dev server
// (HMR rebuilds + cache hits can skip the inliner, leaving a bare
// `process.env.X` runtime ref that throws ReferenceError in the browser).
declare global {
    interface Window {
        __CHAT_WS_URL__?: string;
    }
}

const DEV_PARCEL_PORT = '1234';
const DEV_CHAT_URL = 'ws://localhost:8080';

export function resolveChatUrl(side: TSide): string {
    const override =
        typeof window !== 'undefined' && typeof window.__CHAT_WS_URL__ === 'string'
            ? window.__CHAT_WS_URL__
            : undefined;
    if (override) return `${override.replace(/\/$/, '')}/chat/${side}`;

    if (
        typeof window !== 'undefined' &&
        window.location.hostname === 'localhost' &&
        window.location.port === DEV_PARCEL_PORT
    ) {
        return `${DEV_CHAT_URL}/chat/${side}`;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/chat/${side}`;
}
