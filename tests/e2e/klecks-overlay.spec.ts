import { test, expect } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

async function openOverlay(klecks: KlecksPage) {
    for (let i = 0; i < 6; i++) {
        await klecks.tapHandTool();
        await klecks.page.waitForTimeout(50);
    }
}

test('overlay shows close button and input row', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    await expect(overlay.closeButton()).toBeVisible();
    await expect(overlay.input()).toBeVisible();
    await expect(overlay.sendButton()).toBeVisible();
});

test('overlay is anchored bottom-right and roughly 320x420 on iPad', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    const box = await overlay.root().boundingBox();
    expect(box).not.toBeNull();
    const vp = page.viewportSize()!;
    expect(box!.width).toBeGreaterThanOrEqual(300);
    expect(box!.width).toBeLessThanOrEqual(360);
    expect(box!.height).toBeGreaterThanOrEqual(380);
    expect(box!.height).toBeLessThanOrEqual(460);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(vp.width - 24);
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(vp.height - 24);
});

test('tapping the close button hides the overlay', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    await overlay.close();
    await expect(overlay.root()).toHaveCount(0);
});

test('klecks side does NOT render the attach-image button', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();
    await openOverlay(klecks);

    await expect(overlay.attachButton()).toHaveCount(0);
});

test('opening the overlay opens a WS to /chat/klecks', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);

    const wsUrls: string[] = [];
    page.on('websocket', (ws) => wsUrls.push(ws.url()));

    await klecks.goto();
    await openOverlay(klecks);

    await expect(overlay.root()).toBeVisible();
    await page.waitForTimeout(500); // give the client time to connect
    expect(wsUrls.some((u) => u.endsWith('/chat/klecks'))).toBe(true);
});
