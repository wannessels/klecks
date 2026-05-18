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
