// Offline evaluation of classifiers against a real list export (format `smart-todos-list`,
// version 1). Replays the list's history in time order ("prequential"): for every
// human-confirmed placement, each method only sees what existed before that moment, predicts,
// and is scored against where the item actually went.
//
// Evaluation only. The app's classifier stays local; the Jev adapter here is not used by the
// app (see AGENTS.md, "Classifier").
import {
  classifyTodoText,
  normalizeItemText,
  parseClassifierKeywords,
  shouldAutoSortClassification,
  shouldSuggestClassification,
  tokenizeItemText,
  type ClassificationSample,
  type ClassificationSublist,
  type ClassificationTodo,
} from "./classification";
import { categoryDisplayPath, categoryLeafName, categoryParentPath } from "./categoryTree";

// ---------------------------------------------------------------------------------------------
// Input

export interface EvalCategory {
  id: string;
  name: string;
  createdAt?: string | null;
  order?: number | null;
  classifierKeywords?: string | null;
  group?: string | null;
}

export interface EvalTodo {
  id: string;
  text: string;
  done: boolean;
  categoryId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface EvalSample {
  id: string;
  text: string;
  normalizedText?: string | null;
  source: string;
  categoryId?: string | null;
  createdAt?: string | null;
}

export interface EvalExport {
  format: string;
  version: number;
  list: { name?: string; classifierAggressiveness?: string | null; classifierResetAt?: string | null };
  categories: EvalCategory[];
  todos: EvalTodo[];
  classifierHistory: EvalSample[];
}

export function parseExport(value: unknown): EvalExport {
  const data = value as EvalExport;
  if (!data || data.format !== "smart-todos-list" || data.version !== 1) {
    throw new Error("Not a smart-todos-list version 1 export");
  }
  if (!Array.isArray(data.categories) || !Array.isArray(data.todos) || !Array.isArray(data.classifierHistory)) {
    throw new Error("The export is missing categories, todos or classifierHistory");
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// Label events

/** Sources that record a human decision about where an item belongs. */
export const LABEL_SOURCES = new Set(["checked", "manual-move"]);

/** A checked todo and the `checked` sample written by the same tap count once. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export interface LabelEvent {
  at: number;
  text: string;
  normalizedText: string;
  categoryId: string;
  origin: "checked" | "manual-move" | "done-todo";
  /**
   * A person chose this category: a manual move, or a check-off of an item they had added in or
   * moved to that category shortly before. Otherwise the placement may have been the
   * classifier's, checked off without correcting it.
   */
  trusted: boolean;
  /** Categories that count as right; normally just `categoryId`, more after a review. */
  acceptable: string[];
}

/** Samples that record a person placing an item (as opposed to checking it off). */
export const PLACEMENT_SOURCES = new Set(["quick-add", "explicit-create", "explicit", "manual-move"]);
const PLACEMENT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/** The key a review verdict is filed under: the event's time and item. */
export function eventKey(event: Pick<LabelEvent, "at" | "normalizedText">): string {
  return `${new Date(event.at).toISOString()} ${event.normalizedText}`;
}

/**
 * A reviewed verdict on one event: the categories that are right (several if more than one is
 * fine), or `null` to leave the event out (unclear, or not a placement worth scoring).
 */
export type Verdicts = Map<string, string[] | null>;

export function time(value?: string | number | null): number {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function afterReset(at: number, resetAt: number): boolean {
  return !resetAt || at > resetAt;
}

/**
 * The human-confirmed placements in time order: `checked` and `manual-move` samples, plus done
 * todos with a category that have no matching `checked` sample (older data, or samples lost).
 * Events in categories that no longer exist, without a time, or before a classifier reset are
 * skipped, since nothing could be trained or scored for them.
 */
export function labelEvents(data: EvalExport): LabelEvent[] {
  const categoryIds = new Set(data.categories.map((category) => category.id));
  const resetAt = time(data.list.classifierResetAt);
  const events: LabelEvent[] = [];
  for (const sample of data.classifierHistory) {
    if (!LABEL_SOURCES.has(sample.source) || !sample.categoryId || !categoryIds.has(sample.categoryId)) continue;
    const at = time(sample.createdAt);
    if (!at || !afterReset(at, resetAt)) continue;
    const normalizedText = normalizeItemText(sample.normalizedText || sample.text);
    if (!normalizedText) continue;
    events.push({
      at, text: sample.text, normalizedText, categoryId: sample.categoryId,
      origin: sample.source as LabelEvent["origin"],
      trusted: sample.source === "manual-move" || placedBy(data, normalizedText, sample.categoryId, at),
      acceptable: [sample.categoryId],
    });
  }
  const checked = events.filter((event) => event.origin === "checked");
  for (const todo of data.todos) {
    if (!todo.done || !todo.categoryId || !categoryIds.has(todo.categoryId)) continue;
    const at = time(todo.updatedAt || todo.createdAt);
    if (!at || !afterReset(at, resetAt)) continue;
    const normalizedText = normalizeItemText(todo.text);
    if (!normalizedText) continue;
    const duplicate = checked.some((event) => event.normalizedText === normalizedText
      && event.categoryId === todo.categoryId
      && Math.abs(event.at - at) <= DUPLICATE_WINDOW_MS);
    if (duplicate) continue;
    events.push({
      at, text: todo.text, normalizedText, categoryId: todo.categoryId, origin: "done-todo",
      trusted: placedBy(data, normalizedText, todo.categoryId, at),
      acceptable: [todo.categoryId],
    });
  }
  return events.sort((a, b) => a.at - b.at);
}

/** Whether a person put this item into this category in the weeks before `at`. */
function placedBy(data: EvalExport, normalizedText: string, categoryId: string, at: number): boolean {
  return data.classifierHistory.some((sample) => {
    if (!PLACEMENT_SOURCES.has(sample.source) || sample.categoryId !== categoryId) return false;
    const placedAt = time(sample.createdAt);
    return placedAt > 0 && placedAt <= at && at - placedAt <= PLACEMENT_WINDOW_MS
      && (normalizeItemText(sample.normalizedText || sample.text)) === normalizedText;
  });
}

/** Applies review verdicts: replaces the acceptable categories, or drops the event. */
export function applyVerdicts(events: LabelEvent[], verdicts: Verdicts): LabelEvent[] {
  return events.flatMap((event) => {
    const verdict = verdicts.get(eventKey(event));
    if (verdict === undefined) return [event];
    if (verdict === null) return [];
    return [{ ...event, acceptable: verdict, trusted: true }];
  });
}

export function isRight(event: LabelEvent, categoryId: string | undefined): boolean {
  return !!categoryId && event.acceptable.includes(categoryId);
}

// ---------------------------------------------------------------------------------------------
// What a method may see at a moment

export interface EvalContext {
  /** The moment of the event; everything below happened strictly before it. */
  at: number;
  categories: EvalCategory[];
  aggressiveness: string;
  resetAt: number;
  samples: EvalSample[];
  doneTodos: EvalTodo[];
  /** Earlier human-confirmed placements (a subset of the samples and done todos). */
  labels: LabelEvent[];
}

export function contextAt(data: EvalExport, events: LabelEvent[], at: number): EvalContext {
  return {
    at,
    // Categories created later didn't exist yet (those without a time count as always there).
    categories: data.categories.filter((category) => {
      const createdAt = time(category.createdAt);
      return !createdAt || createdAt < at;
    }),
    aggressiveness: data.list.classifierAggressiveness || "normal",
    resetAt: time(data.list.classifierResetAt),
    samples: data.classifierHistory.filter((sample) => {
      const sampleAt = time(sample.createdAt);
      return sampleAt > 0 && sampleAt < at;
    }),
    // A todo's final state is all the export knows: it counts as done from its last update.
    doneTodos: data.todos.filter((todo) => {
      const todoAt = time(todo.updatedAt || todo.createdAt);
      return todo.done && todoAt > 0 && todoAt < at;
    }),
    labels: events.filter((event) => event.at < at),
  };
}

// ---------------------------------------------------------------------------------------------
// Methods

export interface Prediction {
  categoryId: string;
  confidence: number;
  /** Sorted straight into the category without asking. */
  auto: boolean;
  /** Offered as a suggestion (always true when `auto`). */
  suggest: boolean;
}

export interface EvalMethod {
  name: string;
  predict(text: string, context: EvalContext): Prediction | null | Promise<Prediction | null>;
}

function classificationInputs(context: EvalContext) {
  const sublists: ClassificationSublist[] = context.categories.map((category) => ({
    id: category.id,
    name: category.name,
    classifierKeywords: category.classifierKeywords,
  }));
  const todos: ClassificationTodo[] = context.doneTodos.map((todo) => ({
    text: todo.text,
    done: todo.done,
    createdAt: todo.createdAt || undefined,
    updatedAt: todo.updatedAt,
    sublist: todo.categoryId ? { id: todo.categoryId } : null,
  }));
  const samples: ClassificationSample[] = context.samples.map((sample) => ({
    text: sample.text,
    normalizedText: sample.normalizedText || undefined,
    source: sample.source,
    createdAt: sample.createdAt || undefined,
    sublist: sample.categoryId ? { id: sample.categoryId } : null,
  }));
  return { sublists, todos, samples };
}

/** The app's classifier as it is (lib/classification.ts). */
export const currentMethod: EvalMethod = {
  name: "current",
  predict(text, context) {
    const { sublists, todos, samples } = classificationInputs(context);
    const options = { aggressiveness: context.aggressiveness, resetAt: context.resetAt || null };
    const result = classifyTodoText(text, sublists, todos, samples, options);
    if (!result) return null;
    const auto = shouldAutoSortClassification(result, options);
    return {
      categoryId: result.sublistId,
      confidence: result.confidence,
      auto,
      suggest: auto || shouldSuggestClassification(result, options),
    };
  },
};

/** Where the item went the last time a person placed it, else `fallback`. */
export function latestLabel(normalizedText: string, context: EvalContext): LabelEvent | undefined {
  const categoryIds = new Set(context.categories.map((category) => category.id));
  for (let index = context.labels.length - 1; index >= 0; index -= 1) {
    const label = context.labels[index];
    if (label.normalizedText === normalizedText && categoryIds.has(label.categoryId)) return label;
  }
  return undefined;
}

export function lookupFirst(fallback: EvalMethod, name = "lookup-first"): EvalMethod {
  return {
    name,
    predict(text, context) {
      const label = latestLabel(normalizeItemText(text), context);
      if (label) return { categoryId: label.categoryId, confidence: 1, auto: true, suggest: true };
      return fallback.predict(text, context);
    },
  };
}

// --- Naive Bayes ------------------------------------------------------------------------------

export interface Thresholds {
  auto: number;
  suggest: number;
}

/** Chosen before looking at any real data; the report's sweep shows what other values do. */
export const DEFAULT_NB_THRESHOLDS: Thresholds = { auto: 0.9, suggest: 0.6 };

const TOKEN_WEIGHT = 3;
const TRIGRAM_WEIGHT = 1;

export function itemFeatures(text: string): Map<string, number> {
  const features = new Map<string, number>();
  const add = (feature: string, weight: number) => features.set(feature, (features.get(feature) || 0) + weight);
  for (const token of tokenizeItemText(text)) add(`w:${token}`, TOKEN_WEIGHT);
  const compact = normalizeItemText(text).replace(/\s+/g, "");
  const padded = `^${compact}$`;
  for (let index = 0; index + 3 <= padded.length; index += 1) add(`c:${padded.slice(index, index + 3)}`, TRIGRAM_WEIGHT);
  return features;
}

interface TrainingItem {
  normalizedText: string;
  categoryId: string;
  at: number;
}

/**
 * The positive examples the app's classifier would use, with the same priorities: the latest
 * human-confirmed placement per item text; other non-automatic samples only for texts never
 * confirmed; category keywords. `negative` samples are left out (Naive Bayes has no clean way
 * to use them); `auto` samples are never training data.
 */
export function trainingItems(context: EvalContext): TrainingItem[] {
  const categoryIds = new Set(context.categories.map((category) => category.id));
  const confirmed = new Map<string, TrainingItem>();
  const fallback = new Map<string, TrainingItem>();
  const keep = (map: Map<string, TrainingItem>, item: TrainingItem) => {
    const existing = map.get(item.normalizedText);
    if (!existing || item.at >= existing.at) map.set(item.normalizedText, item);
  };
  for (const todo of context.doneTodos) {
    const at = time(todo.updatedAt || todo.createdAt);
    if (!todo.categoryId || !categoryIds.has(todo.categoryId) || !afterReset(at, context.resetAt)) continue;
    const normalizedText = normalizeItemText(todo.text);
    if (normalizedText) keep(confirmed, { normalizedText, categoryId: todo.categoryId, at });
  }
  for (const sample of context.samples) {
    const at = time(sample.createdAt);
    if (!sample.categoryId || !categoryIds.has(sample.categoryId) || !afterReset(at, context.resetAt)) continue;
    if (sample.source === "negative" || sample.source === "auto") continue;
    const normalizedText = normalizeItemText(sample.normalizedText || sample.text);
    if (!normalizedText) continue;
    keep(LABEL_SOURCES.has(sample.source) ? confirmed : fallback, { normalizedText, categoryId: sample.categoryId, at });
  }
  const items = [...confirmed.values(), ...[...fallback.values()].filter((item) => !confirmed.has(item.normalizedText))];
  for (const category of context.categories) {
    for (const keyword of parseClassifierKeywords(category.classifierKeywords)) {
      const normalizedText = normalizeItemText(keyword);
      if (normalizedText) items.push({ normalizedText, categoryId: category.id, at: 0 });
    }
  }
  return items;
}

/** Multinomial Naive Bayes over word tokens and character trigrams, Laplace smoothing. */
export function naiveBayesMethod(thresholds: Thresholds = DEFAULT_NB_THRESHOLDS, name = "naive-bayes"): EvalMethod {
  return {
    name,
    predict(text, context) {
      const items = trainingItems(context);
      const classes = new Map<string, { examples: number; total: number; counts: Map<string, number> }>();
      const vocabulary = new Set<string>();
      for (const item of items) {
        const entry = classes.get(item.categoryId) ?? { examples: 0, total: 0, counts: new Map<string, number>() };
        entry.examples += 1;
        for (const [feature, weight] of itemFeatures(item.normalizedText)) {
          entry.counts.set(feature, (entry.counts.get(feature) || 0) + weight);
          entry.total += weight;
          vocabulary.add(feature);
        }
        classes.set(item.categoryId, entry);
      }
      if (classes.size < 2) return null;
      const features = itemFeatures(text);
      if (features.size === 0) return null;
      const totalExamples = items.length;
      const scores: Array<[string, number]> = [];
      for (const [categoryId, entry] of classes) {
        let score = Math.log((entry.examples + 1) / (totalExamples + classes.size));
        for (const [feature, weight] of features) {
          score += weight * Math.log(((entry.counts.get(feature) || 0) + 1) / (entry.total + vocabulary.size));
        }
        scores.push([categoryId, score]);
      }
      const max = Math.max(...scores.map(([, score]) => score));
      const exps = scores.map(([categoryId, score]) => [categoryId, Math.exp(score - max)] as const);
      const sum = exps.reduce((total, [, value]) => total + value, 0);
      const [categoryId, value] = [...exps].sort((a, b) => b[1] - a[1])[0];
      const confidence = value / sum;
      return withThresholds({ categoryId, confidence }, thresholds);
    },
  };
}

function withThresholds(prediction: { categoryId: string; confidence: number }, thresholds: Thresholds): Prediction {
  const auto = prediction.confidence >= thresholds.auto;
  return { ...prediction, auto, suggest: auto || prediction.confidence >= thresholds.suggest };
}

// --- Jev (TypeSafe's decision model, through AIMLAPI) ------------------------------------------

export const DEFAULT_JEV_THRESHOLDS: Thresholds = { auto: 0.8, suggest: 0.5 };
const JEV_EXAMPLES_PER_CATEGORY = 8;

export const JEV_INSTRUCTIONS = [
  "This is an item on a household shopping list, usually in German.",
  "The list is sorted by where things are found while shopping: each option is an aisle or",
  "section of a supermarket, or a separate store for things the main store does not carry.",
  "Pick the option where this item is most likely bought. Use the option's description and",
  "the example items that were sorted there before.",
].join(" ");

export interface JevRequest {
  model: string;
  state: { item: string };
  questions: { category: { type: "choice"; instructions: string; criteria: Record<string, string> } };
}

export interface JevResponse {
  answers?: { category?: { choice?: string; confidence?: number; probabilities?: Record<string, number> } };
  meta?: { usd_spent?: number; credits_used?: number; duration_ms?: number };
  error?: unknown;
}

/** Option keys for Jev: readable category names, made unique; mapped back to category ids. */
export function jevOptionKeys(categories: EvalCategory[]): Map<string, string> {
  const keys = new Map<string, string>();
  const used = new Set<string>();
  for (const category of categories) {
    const base = categoryDisplayPath(category).trim() || category.id;
    let key = base;
    for (let index = 2; used.has(key); index += 1) key = `${base} (${index})`;
    used.add(key);
    keys.set(key, category.id);
  }
  return keys;
}

export function buildJevRequest(text: string, context: EvalContext, model: string): { request: JevRequest; keys: Map<string, string> } {
  const keys = jevOptionKeys(context.categories);
  const examples = new Map<string, string[]>();
  for (const item of [...trainingItems(context)].filter((entry) => entry.at > 0).sort((a, b) => b.at - a.at)) {
    const list = examples.get(item.categoryId) ?? [];
    if (list.length < JEV_EXAMPLES_PER_CATEGORY && !list.includes(item.normalizedText)) list.push(item.normalizedText);
    examples.set(item.categoryId, list);
  }
  const criteria: Record<string, string> = {};
  for (const [key, categoryId] of keys) {
    const category = context.categories.find((entry) => entry.id === categoryId)!;
    const parts = [`Section "${categoryLeafName(category)}"`];
    const parent = categoryParentPath(category);
    if (parent) parts.push(`in "${parent.split("/").join(" / ")}"`);
    const keywords = parseClassifierKeywords(category.classifierKeywords);
    if (keywords.length) parts.push(`typical items: ${keywords.join(", ")}`);
    const seen = examples.get(categoryId) ?? [];
    if (seen.length) parts.push(`sorted here before: ${seen.join(", ")}`);
    criteria[key] = parts.join("; ");
  }
  return {
    request: { model, state: { item: text }, questions: { category: { type: "choice", instructions: JEV_INSTRUCTIONS, criteria } } },
    keys,
  };
}

export interface JevOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  thresholds?: Thresholds;
  fetch?: typeof fetch;
  /** Looks up and stores responses by request (the CLI keeps them on disk). */
  cache?: { get(request: JevRequest): Promise<JevResponse | undefined>; set(request: JevRequest, response: JevResponse): Promise<void> };
  maxRequests?: number;
}

export interface JevStats {
  requests: number;
  cached: number;
  skipped: number;
  failed: number;
  usdSpent: number;
}

export const JEV_DEFAULT_URL = "https://api.aimlapi.com/v1/decisions";
export const JEV_DEFAULT_MODEL = "typesafe/jev-1.14";

export function jevMethod(options: JevOptions, name = "jev"): EvalMethod & { stats: JevStats } {
  const stats: JevStats = { requests: 0, cached: 0, skipped: 0, failed: 0, usdSpent: 0 };
  const thresholds = options.thresholds ?? DEFAULT_JEV_THRESHOLDS;
  const doFetch = options.fetch ?? fetch;
  const maxRequests = options.maxRequests ?? 300;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    name,
    stats,
    async predict(text, context) {
      if (context.categories.length < 2) return null;
      const { request, keys } = buildJevRequest(text, context, options.model ?? JEV_DEFAULT_MODEL);
      let response = await options.cache?.get(request);
      if (response) stats.cached += 1;
      else {
        if (stats.requests >= maxRequests) {
          stats.skipped += 1;
          return null;
        }
        stats.requests += 1;
        // One request at a time: gentle on the API, and the cost cap stays exact.
        const run = queue.then(async () => {
          const reply = await doFetch(options.baseUrl ?? JEV_DEFAULT_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(request),
          });
          if (!reply.ok) throw new Error(`Jev answered ${reply.status}: ${(await reply.text()).slice(0, 200)}`);
          return (await reply.json()) as JevResponse;
        });
        queue = run.catch(() => undefined);
        try {
          response = await run;
        } catch (error) {
          stats.failed += 1;
          if (stats.failed <= 3) console.error(String(error));
          return null;
        }
        stats.usdSpent += response.meta?.usd_spent ?? 0;
        await options.cache?.set(request, response);
      }
      const answer = response.answers?.category;
      const categoryId = answer?.choice ? keys.get(answer.choice) : undefined;
      if (!answer || !categoryId) return null;
      const confidence = answer.confidence ?? answer.probabilities?.[answer.choice!] ?? 0;
      return withThresholds({ categoryId, confidence }, thresholds);
    },
  };
}

/** Lookup first, then the app's classifier when it would auto-sort, else Jev. */
export function jevFallbackMethod(jev: EvalMethod, name = "jev-fallback"): EvalMethod {
  return lookupFirst({
    name: `${name}-inner`,
    async predict(text, context) {
      const local = currentMethod.predict(text, context) as Prediction | null;
      if (local?.auto) return local;
      return (await jev.predict(text, context)) ?? local;
    },
  }, name);
}

// ---------------------------------------------------------------------------------------------
// Replay and scoring

export interface EventResult {
  event: LabelEvent;
  coldStart: boolean;
  prediction: Prediction | null;
}

export interface Outcome {
  events: number;
  autoCorrect: number;
  autoWrong: number;
  suggestCorrect: number;
  suggestWrong: number;
  abstained: number;
  /** Top-1 accuracy: the predicted category was right, whatever the confidence; abstaining counts as wrong. */
  accuracy: number | null;
  coldStart: { events: number; accuracy: number | null };
  seenBefore: { events: number; accuracy: number | null };
}

export interface MethodReport {
  method: string;
  outcome: Outcome;
  confusion: Array<{ expected: string; predicted: string; count: number }>;
  results: EventResult[];
}

/** Whether anything with this item text was placed in a category before (any positive source). */
function seenBefore(normalizedText: string, context: EvalContext): boolean {
  if (context.labels.some((label) => label.normalizedText === normalizedText)) return true;
  if (context.doneTodos.some((todo) => normalizeItemText(todo.text) === normalizedText)) return true;
  return context.samples.some((sample) => sample.source !== "negative" && sample.source !== "auto"
    && (normalizeItemText(sample.normalizedText || sample.text)) === normalizedText);
}

export async function replay(
  data: EvalExport,
  methods: EvalMethod[],
  options: {
    maxEvents?: number;
    /** Score only labels a person chose (see `LabelEvent.trusted`). */
    trustedOnly?: boolean;
    /** Score only events from this moment on; training still uses everything before each. */
    since?: number;
    verdicts?: Verdicts;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<MethodReport[]> {
  // The methods see every label as the app would; only the scoring is narrowed.
  const allEvents = labelEvents(data);
  let scored = options.verdicts ? applyVerdicts(allEvents, options.verdicts) : allEvents;
  if (options.trustedOnly) scored = scored.filter((event) => event.trusted);
  if (options.since) scored = scored.filter((event) => event.at >= options.since!);
  const events = options.maxEvents ? scored.slice(-options.maxEvents) : scored;
  const results = new Map(methods.map((method) => [method.name, [] as EventResult[]]));
  for (const [index, event] of events.entries()) {
    const context = contextAt(data, allEvents, event.at);
    const coldStart = !seenBefore(event.normalizedText, context);
    for (const method of methods) {
      const prediction = await method.predict(event.text, context);
      results.get(method.name)!.push({ event, coldStart, prediction });
    }
    options.onProgress?.(index + 1, events.length);
  }
  const names = new Map(data.categories.map((category) => [category.id, category.name]));
  return methods.map((method) => {
    const methodResults = results.get(method.name)!;
    return {
      method: method.name,
      outcome: score(methodResults),
      confusion: confusion(methodResults, names),
      results: methodResults,
    };
  });
}

function ratio(correct: number, total: number): number | null {
  return total === 0 ? null : correct / total;
}

export function score(results: EventResult[], thresholds?: Thresholds): Outcome {
  const outcome: Outcome = {
    events: results.length,
    autoCorrect: 0, autoWrong: 0, suggestCorrect: 0, suggestWrong: 0, abstained: 0,
    accuracy: null,
    coldStart: { events: 0, accuracy: null },
    seenBefore: { events: 0, accuracy: null },
  };
  let correct = 0;
  let coldCorrect = 0;
  let seenCorrect = 0;
  for (const { event, coldStart, prediction: raw } of results) {
    const prediction = raw && thresholds ? withThresholds(raw, thresholds) : raw;
    const right = isRight(event, raw?.categoryId);
    if (right) correct += 1;
    if (coldStart) {
      outcome.coldStart.events += 1;
      if (right) coldCorrect += 1;
    } else {
      outcome.seenBefore.events += 1;
      if (right) seenCorrect += 1;
    }
    if (!prediction || (!prediction.auto && !prediction.suggest)) outcome.abstained += 1;
    else if (prediction.auto) {
      if (right) outcome.autoCorrect += 1;
      else outcome.autoWrong += 1;
    } else if (right) outcome.suggestCorrect += 1;
    else outcome.suggestWrong += 1;
  }
  outcome.accuracy = ratio(correct, results.length);
  outcome.coldStart.accuracy = ratio(coldCorrect, outcome.coldStart.events);
  outcome.seenBefore.accuracy = ratio(seenCorrect, outcome.seenBefore.events);
  return outcome;
}

function confusion(results: EventResult[], names: Map<string, string>) {
  const counts = new Map<string, number>();
  for (const { event, prediction } of results) {
    if (!prediction?.auto || isRight(event, prediction.categoryId)) continue;
    const key = `${event.categoryId}\u0000${prediction.categoryId}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [expected, predicted] = key.split("\u0000");
      return { expected: names.get(expected) ?? expected, predicted: names.get(predicted) ?? predicted, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/**
 * What other thresholds would have done with the same predictions. Picking the best row tunes
 * on the data being evaluated, so read it as an upper bound, not as the method's score.
 */
export function thresholdSweep(results: EventResult[], autos = [0.6, 0.7, 0.8, 0.9, 0.95, 0.99], suggest = 0.5) {
  return autos.map((auto) => ({ thresholds: { auto, suggest: Math.min(suggest, auto) }, outcome: score(results, { auto, suggest: Math.min(suggest, auto) }) }));
}

export function formatPercent(value: number | null): string {
  return value === null ? "–" : `${(value * 100).toFixed(1)}%`;
}

export function formatTable(reports: MethodReport[]): string {
  const header = ["method", "events", "auto ok", "auto wrong", "sugg ok", "sugg wrong", "abstain", "top-1", "cold top-1", "seen top-1"];
  const rows = reports.map(({ method, outcome }) => [
    method,
    String(outcome.events),
    String(outcome.autoCorrect),
    String(outcome.autoWrong),
    String(outcome.suggestCorrect),
    String(outcome.suggestWrong),
    String(outcome.abstained),
    formatPercent(outcome.accuracy),
    `${formatPercent(outcome.coldStart.accuracy)} (${outcome.coldStart.events})`,
    `${formatPercent(outcome.seenBefore.accuracy)} (${outcome.seenBefore.events})`,
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("  ");
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join("\n");
}
