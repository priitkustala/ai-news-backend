// The AI relevance list of the job module `process` (priitkustala/ai-news-backend#2, S-03;
// Locked B-04, W4 section 6 step 3). Source code, not configuration: a change to either list
// is a code change reviewed in a pull request (brief 03, Configuration and tripwire files).

// Sources whose whole feed is AI-specific: every item they publish passes. Every other feed
// source is a general source, whose items pass only on a keyword match. Reddit communities are
// AI-specific by their admission rule (W10 K1), so a `reddit` source counts as AI-specific by
// its type (src/process/relevance.ts).
//
// The active production sources (Locked, News sources: the 11 proposed feeds and the
// Anthropic mirror) whose whole feed is AI-specific, exactly. The three other active sources
// are general: simon-willison (everything feed), google-research-blog and Tech Policy Press.
export const AI_SOURCE_IDS: readonly string[] = [
  'anthropic-news-mirror',
  'deepmind-blog',
  'eu-ai-act-newsletter',
  'federal-register-ai',
  'github-blog-ai',
  'huggingface-blog',
  'mit-news-ai',
  'openai-news',
  'techcrunch-ai',
];

// Not an active source: arXiv cs.AI is an excluded candidate of the locked source list (FAILED
// in the snapshot, removed by the owner's decision of 2026-10-11, row Feed drift). Its id is
// kept only for the local fixture of AC-08 (the arXiv daily cap, B-08), whose fixture feed
// is AI-specific as a whole. Listing it here enables or fetches nothing: sources come from the
// source configuration, and re-admitting arXiv is the owner's decision.
export const FIXTURE_AI_SOURCE_IDS: readonly string[] = ['arxiv-cs-ai'];

// A keyword matches as a whole word or phrase (no letter or digit directly before or after
// it). Acronyms match in their written case only, so `AI` never matches "ai" inside a run
// marker or a word such as "said"; phrases match in any case.
export type Keyword = { term: string; caseSensitive: boolean };

const acronym = (term: string): Keyword => ({ term, caseSensitive: true });
const phrase = (term: string): Keyword => ({ term, caseSensitive: false });

export const AI_KEYWORDS: readonly Keyword[] = [
  acronym('AI'),
  acronym('AIs'),
  acronym('A.I.'),
  acronym('AGI'),
  acronym('LLM'),
  acronym('LLMs'),
  acronym('GPT'),
  acronym('NLP'),
  phrase('artificial intelligence'),
  phrase('machine learning'),
  phrase('deep learning'),
  phrase('reinforcement learning'),
  phrase('neural network'),
  phrase('neural networks'),
  phrase('language model'),
  phrase('language models'),
  phrase('foundation model'),
  phrase('foundation models'),
  phrase('diffusion model'),
  phrase('diffusion models'),
  phrase('open-weights'),
  phrase('open-weight'),
  phrase('open weights'),
  phrase('chatbot'),
  phrase('chatbots'),
  phrase('ChatGPT'),
  phrase('OpenAI'),
  phrase('Anthropic'),
  phrase('DeepMind'),
  phrase('Hugging Face'),
  phrase('computer vision'),
  phrase('natural language processing'),
  phrase('agentic'),
];
