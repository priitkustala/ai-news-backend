// 47-AC-1 (@surface-data, project api): priitkustala/ai-news-backend#47 (S-21a), criterion AC-1.
// Owner's decision of 2026-11-09: a visitor without a sign-in reads the news (built for staging;
// the public site is decided again before the production release).
// Given seeded news and no sign-in (the publishable key only), when feed, categories and items are
// read, then each returns rows (HTTP 200, more than 0 rows) with the same ids the owner reads, and
// the guest's feed row of a seeded item carries the same source name and image policy as the owner's.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { expectRows, readRelation, signIn, type Row } from '../../support/data';
import { NEWS_RELATIONS, idsOf } from '../../support/access';

test(
  '47-AC-1: without a sign-in feed, categories and items return the rows the owner reads',
  { tag: ['@journey-access', '@surface-data', '@story-47'] },
  async ({ request }) => {
    // The seed and the sign-in run as commands and take tens of seconds on the local stack
    test.setTimeout(120_000);
    // Given: seeded news (fixture set AC-20a, two items marked with this run) that the owner reads
    const run = runMarker();
    seed('AC-20a', run);
    const owner = signIn('owner');
    const ownerRows: Record<string, Row[]> = {};
    for (const relation of NEWS_RELATIONS) {
      ownerRows[relation] = expectRows(await readRelation(request, relation, owner), `prerequisite: the owner reads ${relation}`);
      expect(ownerRows[relation].length, `prerequisite: ${relation} holds rows for the owner`).toBeGreaterThan(0);
    }
    const ownerFeedRow = ownerRows.feed.find((row) => typeof row.source_name === 'string' && row.source_name !== '');
    expect(ownerFeedRow, 'prerequisite: the owner reads a feed row of a configured source').toBeDefined();

    // When: feed, categories and items are read with the publishable key and no session
    const guest: Record<string, Row[]> = {};
    for (const relation of NEWS_RELATIONS) {
      // Then: each answers 200 with more than 0 rows and the same ids as the owner's read
      guest[relation] = expectRows(await readRelation(request, relation), `${relation}: the guest's rows`);
      expect(guest[relation].length, `${relation}: the guest's rows are more than 0`).toBeGreaterThan(0);
      expect(idsOf(relation, guest[relation]), `${relation}: the guest reads the ids the owner reads`).toEqual(idsOf(relation, ownerRows[relation]));
    }

    // Then: the guest's feed row of that item carries the owner's source name and image policy
    const guestFeedRow = guest.feed.find((row) => row.id === ownerFeedRow?.id);
    expect(guestFeedRow, 'the guest reads the same feed row').toBeDefined();
    expect(guestFeedRow?.source_name, 'the guest\'s feed row carries the source name').toBe(ownerFeedRow?.source_name);
    expect(guestFeedRow?.image_policy, 'the guest\'s feed row carries the image policy').toBe(ownerFeedRow?.image_policy);
  },
);
