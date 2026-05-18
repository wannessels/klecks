import { Page, expect } from '@playwright/test';

export class ChatOverlayPage {
    constructor(public readonly page: Page) {}

    root() { return this.page.getByTestId('chat-overlay'); }
    closeButton() { return this.root().getByTestId('chat-close'); }
    input() { return this.root().getByTestId('chat-input'); }
    sendButton() { return this.root().getByTestId('chat-send'); }
    attachButton() { return this.root().getByTestId('chat-attach'); }

    isVisible() { return this.root().isVisible(); }

    async close() { await this.closeButton().tap(); }
}
