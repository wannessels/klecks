import { test, expect } from '@playwright/test';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';
import * as path from 'node:path';

test('peer can attach an image; thumbnail appears as a sent bubble', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();

    // setInputFiles bypasses the iOS picker — fills the underlying <input type=file>.
    const fileInput = overlay.root().locator('input[type=file]');
    await fileInput.setInputFiles(path.resolve('tests/fixtures/test-image.jpg'));

    const imgBubble = overlay.root().getByTestId('chat-bubble-mine').locator('img');
    await expect(imgBubble).toBeVisible({ timeout: 8_000 });

    // Resize sanity: outgoing payload should be much smaller than the source.
    const naturalWidth = await imgBubble.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
    expect(naturalWidth).toBeLessThanOrEqual(1024);
});
