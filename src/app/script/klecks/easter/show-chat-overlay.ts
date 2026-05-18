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
