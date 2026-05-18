import { Page, expect } from '@playwright/test';

export class PeerPage {
    constructor(public readonly page: Page) {}

    async goto() {
        await this.page.goto('/peer.html');
    }
}
