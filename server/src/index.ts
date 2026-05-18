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

        const history = store.lastN(50).map((row) => {
            const mine = row.sender === capturedSide;
            return row.kind === 'text'
                ? { kind: 'text' as const, text: row.text, mine }
                : { kind: 'image' as const, data: row.imageData.toString('base64'), mine };
        });
        ws.send(JSON.stringify({ type: 'history', messages: history }));

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
        });

        ws.on('close', () => {
            room.remove(conn);
            console.log(`[ws] disconnect side=${capturedSide}`);
        });
    });
});

httpServer.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
});
