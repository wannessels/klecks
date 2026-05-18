import { test, expect } from '@playwright/test';
import { KlecksPage } from '../pages/klecks.page';

test('klecks loads and hand tool is targetable by data-testid', async ({ page }) => {
    const klecks = new KlecksPage(page);
    await klecks.goto();
    await expect(klecks.handToolButton()).toBeVisible();
});
