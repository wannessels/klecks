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
