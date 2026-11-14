// 41-AC-02a (scenario, @surface-job, project api): priitkustala/ai-news-backend#41, criterion AC-2.
// The job reads the vendor's own news page (source kind page); a page that answers but holds no
// readable post is the source's failure, so a changed layout is a visible source error.
// Given the anthropic-news-mirror source is a page source whose page answers 200 with no /news/ link
// (fixtures/pages/news-changed.html), when the run completes, then the run's source_errors hold the
// source with an error of kind layout, the run is completed or partial, and no other source has an error.
import { test, expect } from '@playwright/test';
import { runDateToday, runMarker } from '../../support/env';
import { ingest, seed } from '../../support/job';
import { signIn } from '../../support/data';

test(
  '41-AC-02a: a page whose layout changed is the source error layout, and the other sources run',
  { tag: ['@journey-ingest', '@surface-job', '@story-41'] },
  async () => {
    // Given: the mirror source reads a page that answers 200 with no readable post
    const run = runMarker();
    const manifest = seed('41-AC-02', run);
    const sourceId = String(manifest.page_source_id);
    expect(sourceId, 'prerequisite: the manifest names the page source').toBe('anthropic-news-mirror');
    signIn('owner');

    // When: the run completes
    const result = ingest(runDateToday());
    expect(result.report?.status, 'prerequisite (1, the run report): the run ends with a recorded status').toMatch(/^(completed|partial|failed)$/);

    // Then: the source's error is of kind layout, the run is completed or partial, no other source has an error
    const errors = result.report?.source_errors ?? [];
    const own = errors.filter((e) => e.source_id === sourceId);
    expect(own.length, 'the page source has one error').toBe(1);
    expect(own[0]?.error ?? '').toMatch(/^layout:/);
    expect(result.report?.status).toMatch(/^(completed|partial)$/);
    expect(errors.filter((e) => e.source_id !== sourceId), 'no other source has an error').toEqual([]);
  },
);
