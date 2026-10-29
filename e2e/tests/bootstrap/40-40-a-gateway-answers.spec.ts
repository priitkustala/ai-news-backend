// 40a (bootstrap, @surface-data, project api): the environment bootstrap story (#40), coverage.md row 40 a.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// section Local test environment (bootstrap checks).
// Given the compose stack started by the start command, when its Data API address is requested, then the
// gateway answers.
import { test, expect } from '@playwright/test';
import { dataUrl } from '../../support/data';
import { requireEnv } from '../../support/env';

test(
  '40a: the local Supabase interface gateway answers at its local address',
  { tag: ['@journey-bootstrap', '@surface-data', '@story-40'] },
  async ({ request }) => {
    // Given: the compose stack is started with the start command written in AGENTS.md (#40)
    const key = requireEnv('E2E_PUBLISHABLE_KEY', 'the local publishable key of the local Supabase interface');

    // When: the local Supabase interface is requested at its local address
    const response = await request.get(`${dataUrl()}/`, { headers: { apikey: key } });

    // Then: the gateway answers (any HTTP answer below 500)
    expect(response.status()).toBeLessThan(500);
  },
);
