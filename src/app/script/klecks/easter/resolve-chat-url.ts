export type TSide = 'klecks' | 'peer';

declare const process: { env: { CHAT_WS_URL?: string } } | undefined;

export function resolveChatUrl(side: TSide): string {
    const override = typeof process !== 'undefined' ? process?.env?.CHAT_WS_URL : undefined;
    if (override) return `${override.replace(/\/$/, '')}/chat/${side}`;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/chat/${side}`;
}
