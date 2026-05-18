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
