import { Page, expect } from '@playwright/test';

export class KlecksPage {
    constructor(public readonly page: Page) {}

    async goto() {
        await this.page.goto('/');
        // Klecks shows a loading screen that removes itself when ready.
        await expect(this.page.locator('#loading-screen')).toHaveCount(0, { timeout: 15_000 });
    }

    handToolButton() {
        return this.page.getByTestId('tool-hand');
    }

    async tapHandTool() {
        await this.handToolButton().tap();
    }
}
