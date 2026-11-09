// 47-AC-3 (@surface-data, project api): priitkustala/ai-news-backend#47 (S-21a), criterion AC-3.
// Personal data stays behind the owner's sign-in while the news opens to guests.
// Given the owner has written a bookmark and a push subscription, when bookmarks and
// push_subscriptions are read without a sign-in, then none is returned; when app_private.owner and
// app_private.sources are read (profile header app_private), then they are refused and no row returns.
import { test, expect } from '@playwright/test';
import { runMarker } from '../../support/env';
import { seed } from '../../support/job';
import { bookmarkFor, describeRead, expectRows, isRefusedOrEmpty, readRelation, signIn, writeRelation } from '../../support/data';
import { readSelected, seededItem } from '../../support/access';

test(
  '47-AC-3: without a sign-in bookmarks and push subscriptions return none and the private schema is refused',
  { tag: ['@journey-access', '@surface-data', '@story-47'] },
  async ({ request }) => {
    // The seed and the sign-in run as commands and take tens of seconds on the local stack
    test.setTimeout(120_000);
    // Given: the owner's bookmark and push subscription, written as the client writes them and read
    // back; a failed write or readback is a failed prerequisite, never this row's Then
    const run = runMarker();
    seed('AC-20a', run);
    const owner = signIn('owner');
    const item = await seededItem(request, owner, `${run}-a`);
    const bookmark = await writeRelation(request, 'bookmarks', 'POST', bookmarkFor(item), owner);
    expect(bookmark.status, `prerequisite: the owner's bookmark insert succeeds (${bookmark.body.slice(0, 200)})`).toBe(201);
    const endpoint = `https://fixtures.invalid/${run}/push`;
    const sub = { endpoint, keys: { p256dh: `${run}-p256dh`, auth: `${run}-auth` } };
    const push = await writeRelation(request, 'push_subscriptions', 'POST', sub, owner);
    expect(push.status, `prerequisite: the owner's push subscription insert succeeds (${push.body.slice(0, 200)})`).toBe(201);
    const bookmarkBack = await readRelation(request, 'bookmarks', owner, `item_id=eq.${encodeURIComponent(String(item.id))}`);
    expect(expectRows(bookmarkBack, 'prerequisite: the owner reads bookmarks'), 'prerequisite: the owner reads the bookmark back').toHaveLength(1);
    const pushBack = await readRelation(request, 'push_subscriptions', owner, `endpoint=eq.${encodeURIComponent(endpoint)}`);
    expect(expectRows(pushBack, 'prerequisite: the owner reads push_subscriptions'), 'prerequisite: the owner reads the subscription back').toHaveLength(1);

    // When: bookmarks and push_subscriptions are read with the publishable key and no session
    for (const relation of ['bookmarks', 'push_subscriptions']) {
      const read = await readRelation(request, relation);
      // Then: none is returned (refused, or a well-formed empty list)
      expect(read.status, `${relation} is in the exposed schema`).not.toBe(404);
      expect(read.malformed, `${relation}: the answer is not a malformed list`).toBe(false);
      expect(isRefusedOrEmpty(read), `${relation}: no row is returned (${describeRead(read)})`).toBe(true);
    }

    // When: app_private.owner and app_private.sources are read with the profile header and no session
    for (const relation of ['owner', 'sources']) {
      const read = await readSelected(request, relation, { profile: 'app_private' });
      // Then: the interface refuses the read and returns no row
      expect(read.status, `app_private.${relation} is refused (${describeRead(read)})`).not.toBe(200);
      expect(read.rows, `app_private.${relation} returns no row`).toEqual([]);
    }
  },
);
