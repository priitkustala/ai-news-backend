// The AI-specific source ids (priitkustala/ai-news#108; approved settlement 47 of 2026-11-09,
// B-04): the five ids of config/sources.json whose whole feed is AI-specific pass every item;
// nvidia-blog stays a general source. Runs on the built modules after npm run build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_SOURCE_IDS } from '../dist/process/keywords.js';
import { relevance } from '../dist/process/relevance.js';

const FIVE = ['google-ai-blog', 'google-research-blog', 'import-ai', 'mit-technology-review-ai', 'simon-willison'];
const NO_KEYWORD = 'Notes on a quiet week in the garden';

test('the five ids are AI-specific and nvidia-blog is not', () => {
  for (const id of FIVE) assert.ok(AI_SOURCE_IDS.includes(id), `${id} is in AI_SOURCE_IDS`);
  assert.ok(!AI_SOURCE_IDS.includes('nvidia-blog'));
});

test('a title with no keyword passes for simon-willison by its source', () => {
  assert.equal(relevance({ id: 'simon-willison', source_type: 'feed' }, NO_KEYWORD), 'source');
});

test('the same title is not kept for nvidia-blog', () => {
  assert.equal(relevance({ id: 'nvidia-blog', source_type: 'feed' }, NO_KEYWORD), null);
});
