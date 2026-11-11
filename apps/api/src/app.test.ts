import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

describe('api', () => {
  it('answers /health', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', name: 'ai-erp-core' });
    await app.close();
  });
});
