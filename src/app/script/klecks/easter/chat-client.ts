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
