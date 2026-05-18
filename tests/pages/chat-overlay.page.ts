import { Page } from '@playwright/test';

export class ChatOverlayPage {
    constructor(public readonly page: Page) {}

    root() {
        return this.page.getByTestId('chat-overlay');
    }

    isVisible() {
        return this.root().isVisible();
    }
}
