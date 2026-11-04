// The AI relevance list of the job module `process` (priitkustala/ai-news-backend#2, S-03;
// Locked B-04, W4 section 6 step 3). Source code, not configuration: a change to either list
// is a code change reviewed in a pull request (brief 03, Configuration and tripwire files).

// Sources whose whole feed is AI-specific (Locked, News sources and the Anthropic mirror):
// every item they publish passes. Every other feed source is a general source, whose items
// pass only on a keyword match. Reddit communities are AI-specific by their admission rule
// (W10 K1), so a `reddit` source counts as AI-specific by its type (src/process/relevance.ts).
export const AI_SOURCE_IDS: readonly string[] = [
  'anthropic-news-mirror',
  'arxiv-cs-ai',
  'deepmind-blog',
  'eu-ai-act-newsletter',
  'federal-register-ai',
  'github-blog-ai',
  'huggingface-blog',
  'mit-news-ai',
  'openai-news',
  'techcrunch-ai',
];

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
