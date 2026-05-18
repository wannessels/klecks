import { test, expect, devices } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';
import { PeerPage } from '../pages/peer.page';
import { ChatOverlayPage } from '../pages/chat-overlay.page';
import { dockerComposeRestart } from '../helpers/docker';
import * as path from 'node:path';

test('history survives docker compose restart', async ({ browser }) => {
    const phone = await browser.newContext({ ...devices['iPhone SE'] });
    const phonePage = await phone.newPage();
    const peer = new PeerPage(phonePage);
    const overlay = new ChatOverlayPage(phonePage);

    await peer.goto();
    const stamp = `restart-${Date.now()}`;
    await overlay.input().fill(`survive ${stamp}`);
    await overlay.sendButton().tap();
    await expect(overlay.root().getByTestId('chat-bubble-mine').filter({ hasText: stamp })).toBeVisible();

    // Drop image too
    await overlay.root().locator('input[type=file]').setInputFiles(path.resolve('tests/fixtures/test-image.jpg'));
    await expect(overlay.root().getByTestId('chat-bubble-mine').locator('img').last()).toBeVisible({ timeout: 8_000 });

    await phone.close();
    dockerComposeRestart();
    // Give the container a moment to settle.
    await new Promise((r) => setTimeout(r, 3000));

    const phone2 = await browser.newContext({ ...devices['iPhone SE'] });
    const phonePage2 = await phone2.newPage();
    const peer2 = new PeerPage(phonePage2);
    const overlay2 = new ChatOverlayPage(phonePage2);
    await peer2.goto();
    await expect(overlay2.root().getByTestId('chat-bubble-mine').filter({ hasText: stamp })).toBeVisible({ timeout: 8_000 });
    await expect(overlay2.root().getByTestId('chat-bubble-mine').locator('img').last()).toBeVisible({ timeout: 8_000 });
    await phone2.close();
});
