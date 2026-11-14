// Model-backed methods for the classifier evaluation (lib/classifier-eval.ts), through
// OpenAI-compatible APIs: OpenRouter by default, or a local server (Ollama, llama.cpp, an
// embedding proxy) via a base URL. Evaluation only; the app's classifier stays local.
//
// - `llmChoiceMethod`: a Jev-style decision with a chat model. The categories become lettered
//   options, the model answers with one letter, and the first token's log probabilities give a
//   probability per option. Providers that drop `logprobs` still give an answer, but without a
//   probability it is only ever a suggestion.
// - `embeddingMethod`: nearest neighbours. Every distinct item text and category name is
//   embedded once (cached), and a new item goes where its most similar earlier items went.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeItemText } from "./classification";
import {
  JEV_INSTRUCTIONS,
  buildJevRequest,
  trainingItems,
  type EvalContext,
  type EvalMethod,
  type Prediction,
  type Thresholds,
} from "./classifier-eval";

export interface ModelStats {
  requests: number;
  cached: number;
  skipped: number;
  failed: number;
  /** Reported by OpenRouter (`usage.cost`); 0 where the server doesn't say. */
  usdSpent: number;
  /** Answers that came without log probabilities (suggestion only). */
  withoutLogprobs: number;
}

export interface JsonCache {
  get(key: unknown): Promise<unknown | undefined>;
  set(key: unknown, value: unknown): Promise<void>;
}

/** Responses on disk, one file per request hash. */
export function diskJsonCache(directory: string): JsonCache {
  const file = (key: unknown) => path.join(directory, `${createHash("sha256").update(JSON.stringify(key)).digest("hex")}.json`);
  return {
    async get(key) {
      try {
        return JSON.parse(await readFile(file(key), "utf8"));
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      await mkdir(directory, { recursive: true });
      await writeFile(file(key), JSON.stringify(value));
    },
  };
}

interface ApiOptions {
  apiKey?: string;
  baseUrl: string;
  model: string;
  fetch?: typeof fetch;
  cache?: JsonCache;
  maxRequests?: number;
  thresholds?: Thresholds;
}

function newStats(): ModelStats {
  return { requests: 0, cached: 0, skipped: 0, failed: 0, usdSpent: 0, withoutLogprobs: 0 };
}

/** POSTs one request at a time, with the cache and the request cap in front. */
function client(options: ApiOptions, stats: ModelStats) {
  const doFetch = options.fetch ?? fetch;
  const maxRequests = options.maxRequests ?? 300;
  let queue: Promise<unknown> = Promise.resolve();
  return async function post<T>(endpoint: string, body: unknown): Promise<T | undefined> {
    const cached = await options.cache?.get({ endpoint, body });
    if (cached !== undefined) {
      stats.cached += 1;
      return cached as T;
    }
    if (stats.requests >= maxRequests) {
      stats.skipped += 1;
      return undefined;
    }
    stats.requests += 1;
    const run = queue.then(async () => {
      const reply = await doFetch(`${options.baseUrl.replace(/\/$/, "")}/${endpoint}`, {
        method: "POST",
        headers: {
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!reply.ok) throw new Error(`${endpoint} answered ${reply.status}: ${(await reply.text()).slice(0, 300)}`);
      return (await reply.json()) as T;
    });
    queue = run.catch(() => undefined);
    try {
      const response = await run;
      const cost = (response as { usage?: { cost?: number } })?.usage?.cost;
      if (typeof cost === "number") stats.usdSpent += cost;
      await options.cache?.set({ endpoint, body }, response);
      return response;
    } catch (error) {
      stats.failed += 1;
      if (stats.failed <= 3) console.error(String(error));
      return undefined;
    }
  };
}

function withThresholds(categoryId: string, confidence: number, thresholds: Thresholds): Prediction {
  const auto = confidence >= thresholds.auto;
  return { categoryId, confidence, auto, suggest: auto || confidence >= thresholds.suggest };
}

// --- Jev-style choice with a chat model --------------------------------------------------------

export const DEFAULT_LLM_THRESHOLDS: Thresholds = { auto: 0.8, suggest: 0.5 };
export const DEFAULT_LLM_MODEL = "openai/gpt-4.1-nano";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The chat request: the same option descriptions as the Jev request, lettered. */
export function buildChoiceRequest(text: string, context: EvalContext, model: string) {
  const { request, keys } = buildJevRequest(text, context, model);
  const criteria = Object.entries(request.questions.category.criteria).slice(0, LETTERS.length);
  const letters = new Map<string, string>();
  const lines = criteria.map(([key, description], index) => {
    letters.set(LETTERS[index], keys.get(key)!);
    return `${LETTERS[index]}) ${description}`;
  });
  return {
    letters,
    body: {
      model,
      temperature: 0,
      max_tokens: 1,
      logprobs: true,
      top_logprobs: 20,
      // OpenRouter: only route to providers that honour logprobs; other servers ignore it.
      provider: { require_parameters: true },
      usage: { include: true },
      messages: [
        { role: "system", content: `${JEV_INSTRUCTIONS} Answer with the letter of one option and nothing else.` },
        { role: "user", content: `Item: ${text}\n\nOptions:\n${lines.join("\n")}` },
      ],
    },
  };
}

interface ChatResponse {
  choices?: Array<{
    message?: { content?: string | null };
    logprobs?: { content?: Array<{ token: string; logprob: number; top_logprobs?: Array<{ token: string; logprob: number }> }> } | null;
  }>;
  usage?: { cost?: number };
}

/** Probability per option letter from the first token's alternatives, renormalised. */
export function letterProbabilities(response: ChatResponse, letters: Map<string, string>): Map<string, number> | null {
  const first = response.choices?.[0]?.logprobs?.content?.[0];
  if (!first) return null;
  const candidates = first.top_logprobs?.length ? first.top_logprobs : [first];
  const probabilities = new Map<string, number>();
  for (const { token, logprob } of candidates) {
    const letter = token.trim().replace(/[).:]$/, "").toUpperCase();
    if (!letters.has(letter)) continue;
    probabilities.set(letter, (probabilities.get(letter) ?? 0) + Math.exp(logprob));
  }
  const total = [...probabilities.values()].reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  for (const [letter, value] of probabilities) probabilities.set(letter, value / total);
  return probabilities;
}

export function llmChoiceMethod(options: ApiOptions, name = "llm"): EvalMethod & { stats: ModelStats } {
  const stats = newStats();
  const post = client(options, stats);
  const thresholds = options.thresholds ?? DEFAULT_LLM_THRESHOLDS;
  return {
    name,
    stats,
    async predict(text, context) {
      if (context.categories.length < 2) return null;
      const { letters, body } = buildChoiceRequest(text, context, options.model);
      const response = await post<ChatResponse>("chat/completions", body);
      if (!response) return null;
      const probabilities = letterProbabilities(response, letters);
      if (probabilities) {
        const [letter, confidence] = [...probabilities].sort((a, b) => b[1] - a[1])[0];
        return withThresholds(letters.get(letter)!, confidence, thresholds);
      }
      stats.withoutLogprobs += 1;
      const letter = (response.choices?.[0]?.message?.content ?? "").trim().charAt(0).toUpperCase();
      const categoryId = letters.get(letter);
      // Without probabilities the answer can't be trusted to sort on its own.
      return categoryId ? { categoryId, confidence: thresholds.suggest, auto: false, suggest: true } : null;
    },
  };
}

// --- Embeddings, nearest neighbours ------------------------------------------------------------

export const DEFAULT_EMBEDDING_THRESHOLDS: Thresholds = { auto: 0.8, suggest: 0.5 };
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";
const NEIGHBOURS = 10;
/** Softmax temperature over cosine similarities: neighbours 0.05 apart differ by a factor e. */
const TEMPERATURE = 0.05;
const BATCH = 64;

interface EmbeddingResponse {
  data?: Array<{ index: number; embedding: number[] }>;
  usage?: { cost?: number };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

/**
 * Weighted vote of the nearest neighbours: weights exp(similarity / T), confidence the best
 * category's share. Pure, for tests.
 */
export function neighbourVote(
  query: number[],
  neighbours: Array<{ categoryId: string; vector: number[] }>,
  k = NEIGHBOURS,
): { categoryId: string; confidence: number; similarity: number } | null {
  const scored = neighbours
    .map((neighbour) => ({ ...neighbour, similarity: cosine(query, neighbour.vector) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
  if (scored.length === 0) return null;
  const top = scored[0].similarity;
  const votes = new Map<string, number>();
  for (const { categoryId, similarity } of scored) {
    votes.set(categoryId, (votes.get(categoryId) ?? 0) + Math.exp((similarity - top) / TEMPERATURE));
  }
  const total = [...votes.values()].reduce((sum, value) => sum + value, 0);
  const [categoryId, weight] = [...votes].sort((a, b) => b[1] - a[1])[0];
  return { categoryId, confidence: weight / total, similarity: top };
}

export function embeddingMethod(options: ApiOptions, name = "embed"): EvalMethod & { stats: ModelStats } {
  const stats = newStats();
  const post = client(options, stats);
  const thresholds = options.thresholds ?? DEFAULT_EMBEDDING_THRESHOLDS;
  const vectors = new Map<string, number[] | null>();

  async function ensure(texts: string[]) {
    const missing = [...new Set(texts)].filter((text) => !vectors.has(text));
    for (let start = 0; start < missing.length; start += BATCH) {
      const batch = missing.slice(start, start + BATCH);
      const response = await post<EmbeddingResponse>("embeddings", { model: options.model, input: batch });
      for (const text of batch) vectors.set(text, null);
      for (const item of response?.data ?? []) vectors.set(batch[item.index], item.embedding);
    }
  }

  return {
    name,
    stats,
    async predict(text, context) {
      if (context.categories.length < 2) return null;
      const query = normalizeItemText(text);
      if (!query) return null;
      // Earlier placements plus each category's own name, so a category without examples
      // still attracts what its name describes ("Getränke" → "Mineralwasser").
      const items = trainingItems(context).map((item) => ({ text: item.normalizedText, categoryId: item.categoryId }));
      for (const category of context.categories) items.push({ text: normalizeItemText(category.name), categoryId: category.id });
      await ensure([query, ...items.map((item) => item.text)]);
      const queryVector = vectors.get(query);
      if (!queryVector) return null;
      const neighbours = items.flatMap((item) => {
        const vector = vectors.get(item.text);
        return vector ? [{ categoryId: item.categoryId, vector }] : [];
      });
      const vote = neighbourVote(queryVector, neighbours);
      return vote ? withThresholds(vote.categoryId, vote.confidence, thresholds) : null;
    },
  };
}
