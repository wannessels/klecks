import { test, expect } from '@playwright/test';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

test('peer.html shows the chat overlay immediately, no close button', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();
    await expect(overlay.root()).toBeVisible();
    await expect(overlay.closeButton()).toHaveCount(0);
});

test('peer.html renders the attach-image button', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();
    await expect(overlay.attachButton()).toBeVisible();
});

test('peer overlay fills the iPhone SE viewport', async ({ page }) => {
    const peer = new PeerPage(page);
    const overlay = new ChatOverlayPage(page);
    await peer.goto();
    const box = await overlay.root().boundingBox();
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(vp.width - 16);
    expect(box!.height).toBeGreaterThanOrEqual(vp.height - 80); // some allowance for safe-area
});
