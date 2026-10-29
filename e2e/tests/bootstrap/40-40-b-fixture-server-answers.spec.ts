// 40b (bootstrap, @surface-job, project api): the environment bootstrap story (#40), coverage.md row 40 b.
// Source: LOCKED specification SHA-256 d32043642ac985b907e6ccb80e8d1fc4868ae3c526c2453ccace6517a3dac890,
// section Local test environment (bootstrap checks).
// Given the fixture feed server with canned RSS and Atom files, when a fixture feed is requested on its port,
// then it answers.
import { test, expect } from '@playwright/test';
import { requireEnv } from '../../support/env';

test(
  '40b: the fixture feed server answers on its port with a feed',
  { tag: ['@journey-bootstrap', '@surface-job', '@story-40'] },
  async ({ request }) => {
    // Given: the fixture feed server of the local test environment (proposed port 8081, fixed by #40)
    const feedUrl = requireEnv('E2E_FIXTURE_FEED_URL', 'the address of one canned feed on the fixture feed server');

    // When: a fixture feed is requested on its port
    const response = await request.get(feedUrl);

    // Then: the fixture feed server answers with an RSS or Atom document
    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(/<rss\b|<feed\b/);
  },
);
