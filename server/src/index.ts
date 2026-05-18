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
