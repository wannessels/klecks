import { test, expect, devices } from '@playwright/test';
import { PeerPage } from '../pages/peer.page';
import { KlecksPage } from '../pages/klecks.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';
import { ImageLightboxPage } from '../pages/image-lightbox.page';
import * as path from 'node:path';

async function openKlecksOverlay(klecks: KlecksPage) {
    for (let i = 0; i < 6; i++) {
        await klecks.tapHandTool();
        await klecks.page.waitForTimeout(50);
    }
}

test('image sent from peer reaches klecks as a left-aligned thumbnail', async ({ browser }) => {
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

    await peerOverlay.root().locator('input[type=file]').setInputFiles(path.resolve('tests/fixtures/test-image.jpg'));

    const theirs = klecksOverlay.root().getByTestId('chat-bubble-theirs').locator('img').last();
    await expect(theirs).toBeVisible({ timeout: 8_000 });
    expect(await theirs.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    await ipad.close();
    await phone.close();
});

test('tapping a thumbnail opens the fullscreen lightbox; tapping it closes', async ({ browser }) => {
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const phonePage = await phone.newPage();
    const peer = new PeerPage(phonePage);
    const peerOverlay = new ChatOverlayPage(phonePage);
    const lightbox = new ImageLightboxPage(phonePage);

    await peer.goto();
    await peerOverlay.root().locator('input[type=file]').setInputFiles(path.resolve('tests/fixtures/test-image.jpg'));
    const thumb = peerOverlay.root().getByTestId('chat-image-thumb').last();
    await expect(thumb).toBeVisible({ timeout: 8_000 });
    await thumb.tap();

    await expect(lightbox.root()).toBeVisible();
    await lightbox.close();
    await expect(lightbox.root()).toHaveCount(0);

    await phone.close();
});

test('klecks side has no attach-image button', async ({ browser }) => {
    const ipad = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
    const ipadPage = await ipad.newPage();
    const klecks = new KlecksPage(ipadPage);
    const klecksOverlay = new ChatOverlayPage(ipadPage);

    await klecks.goto();
    await openKlecksOverlay(klecks);
    await expect(klecksOverlay.attachButton()).toHaveCount(0);

    await ipad.close();
});
