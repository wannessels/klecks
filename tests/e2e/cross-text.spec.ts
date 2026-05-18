import { test, expect, devices } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';

async function openKlecksOverlay(klecks: KlecksPage) {
    for (let i = 0; i < 6; i++) {
        await klecks.tapHandTool();
        await klecks.page.waitForTimeout(50);
    }
}

test('text travels from klecks (iPad) to peer (iPhone)', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const ipadPage = await ipad.newPage();
    const phonePage = await phone.newPage();

    const klecks = new KlecksPage(ipadPage);
    const peer = new PeerPage(phonePage);
    const klecksOverlay = new ChatOverlayPage(ipadPage);
    const peerOverlay = new ChatOverlayPage(phonePage);

    await klecks.goto();
    await peer.goto();
    await openKlecksOverlay(klecks);

    const stamp = `i2p-${Date.now()}`;
    await klecksOverlay.input().fill(`hi from ipad ${stamp}`);
    await klecksOverlay.sendButton().tap();

    await expect(peerOverlay.root().getByTestId('chat-bubble-theirs').filter({ hasText: stamp })).toBeVisible({ timeout: 5_000 });
    await ipad.close();
    await phone.close();
});

test('text travels from peer (iPhone) to klecks (iPad)', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const ipadPage = await ipad.newPage();
    const phonePage = await phone.newPage();

    const klecks = new KlecksPage(ipadPage);
    const peer = new PeerPage(phonePage);
    const klecksOverlay = new ChatOverlayPage(ipadPage);
    const peerOverlay = new ChatOverlayPage(phonePage);

    await klecks.goto();
    await peer.goto();
    await openKlecksOverlay(klecks);

    const stamp = `p2i-${Date.now()}`;
    await peerOverlay.input().fill(`hi from iphone ${stamp}`);
    await peerOverlay.sendButton().tap();

    await expect(klecksOverlay.root().getByTestId('chat-bubble-theirs').filter({ hasText: stamp })).toBeVisible({ timeout: 5_000 });
    await ipad.close();
    await phone.close();
});

test('after reload, klecks sees its prior sent messages right-aligned', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const ipadPage = await ipad.newPage();
    const klecks = new KlecksPage(ipadPage);
    const overlay = new ChatOverlayPage(ipadPage);

    await klecks.goto();
    await openKlecksOverlay(klecks);

    const stamp = `reload-${Date.now()}`;
    await overlay.input().fill(`persistent ${stamp}`);
    await overlay.sendButton().tap();
    await expect(overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: stamp })).toBeVisible();

    // Reload and reopen the overlay.
    await ipadPage.reload();
    await klecks.goto(); // re-runs the loading-screen wait
    await openKlecksOverlay(klecks);

    await expect(overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: stamp })).toBeVisible({ timeout: 5_000 });
    await ipad.close();
});
