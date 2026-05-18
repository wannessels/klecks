import { test, expect } from '@playwright/test';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

test('peer can send a text message and see its own bubble', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();

    const stamp = `peer-${Date.now()}`;
    await overlay.input().fill(`hi ${stamp}`);
    await overlay.sendButton().tap();

    const myBubble = overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: `hi ${stamp}` });
    await expect(myBubble).toBeVisible();
});
