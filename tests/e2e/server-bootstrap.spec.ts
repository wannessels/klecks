import { test, expect, request } from '@playwright/test';

const SERVER = process.env.CHAT_SERVER_URL || 'http://localhost:8080';

test('chat server /health returns 200 OK', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/health`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('OK');
    await ctx.dispose();
});

test('chat server returns 404 for unknown paths when static is disabled', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${SERVER}/does-not-exist`);
    expect(res.status()).toBe(404);
    await ctx.dispose();
});
