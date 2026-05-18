import { test, expect } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

async function tapHand(klecks: KlecksPage, times: number, interval = 50) {
    for (let i = 0; i < times; i++) {
        await klecks.tapHandTool();
        if (i < times - 1) await klecks.page.waitForTimeout(interval);
    }
}

test('6 hand taps within 5s open the chat overlay', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();

    await tapHand(klecks, 6, 50);

    await expect(overlay.root()).toBeVisible();
});

test('6 hand taps spread over more than 5s do NOT trigger', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();

    // ~1.1s gap × 5 gaps = 5.5s total — exceeds the window
    await tapHand(klecks, 6, 1_100);

    await expect(overlay.root()).toHaveCount(0);
});

test('a non-hand tap between hand taps resets the counter', async ({ page }) => {
    const klecks = new KlecksPage(page);
    const overlay = new ChatOverlayPage(page);
    await klecks.goto();

    // 5 hand → 1 brush → 1 hand (= only 1 consecutive hand) — should NOT trigger
    await tapHand(klecks, 5, 50);
    await page.getByTitle(/brush/i).first().tap(); // brush tool by title — replace with data-testid if needed
    await klecks.tapHandTool();

    await expect(overlay.root()).toHaveCount(0);
});
