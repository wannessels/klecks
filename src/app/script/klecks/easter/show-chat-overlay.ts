import { ChatOverlay } from './chat-overlay';
import { ChatClient } from './chat-client';
import { resolveChatUrl } from './resolve-chat-url';

let overlay: ChatOverlay | undefined;
let client: ChatClient | undefined;

export function showChatOverlay(anchorEl?: HTMLElement): void {
    if (!overlay) {
        const localOverlay = new ChatOverlay({
            closeable: true,
            allowImageUpload: false,
            anchorEl,
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
