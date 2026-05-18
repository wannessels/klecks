import { ChatOverlay } from './klecks/easter/chat-overlay';
import { ChatClient } from './klecks/easter/chat-client';
import { resolveChatUrl } from './klecks/easter/resolve-chat-url';

let client: ChatClient;
const overlay = new ChatOverlay({
    closeable: false,
    allowImageUpload: true,
    onSendText: (t) => client.sendText(t),
    onSendImage: (b) => client.sendImage(b),
});
client = new ChatClient({
    url: resolveChatUrl('peer'),
    onMessage: (m) => {
        if (m.type === 'message') overlay.renderIncoming(m);
        else if (m.type === 'history') for (const e of m.messages) overlay.renderIncoming({ ...e, mine: e.mine });
    },
});
overlay.show();
