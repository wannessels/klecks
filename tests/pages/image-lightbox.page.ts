import { Page } from '@playwright/test';

export class ImageLightboxPage {
    constructor(public readonly page: Page) {}
    root() { return this.page.getByTestId('image-lightbox'); }
    image() { return this.root().locator('img'); }
    isVisible() { return this.root().isVisible(); }
    async close() { await this.root().tap(); }
}
