export interface ClassificationSublist {
  id: string;
  name: string;
}

export interface ClassificationTodo {
  text: string;
  sublist?: { id: string } | null;
}

export interface ClassificationSample {
  text: string;
  normalizedText?: string;
  source?: string;
  sublist?: { id: string } | null;
}

export interface ClassificationResult {
  sublistId: string;
  confidence: number;
  reason: "exact" | "tokens";
}

interface TrainingExample {
  normalizedText: string;
  tokens: string[];
  sublistId: string;
}

const MIN_TOTAL_EXAMPLES = 4;
const MIN_CATEGORIES = 2;
const MIN_TOKEN_CONFIDENCE = 0.72;
const MIN_EXACT_CONFIDENCE = 0.75;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einer",
  "eines",
  "for",
  "mit",
  "of",
  "the",
  "und",
  "von",
]);

const UNIT_WORDS = new Set([
  "btl",
  "dose",
  "dosen",
  "g",
  "glas",
  "glaeser",
  "kg",
  "l",
  "ml",
  "pack",
  "packs",
  "pkg",
  "stk",
  "stueck",
  "x",
]);

export function normalizeItemText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u00df/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d+([,.]\d+)?\s*(x|g|kg|ml|l|stk|stuck|stueck|pack|packs|pkg|dose|dosen|glas|glaeser|btl)?\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeItemText(text: string): string[] {
  return normalizeItemText(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token) && !UNIT_WORDS.has(token));
}

export function classifyTodoText(
  text: string,
  sublists: ClassificationSublist[],
  todos: ClassificationTodo[],
  samples: ClassificationSample[] = [],
): ClassificationResult | null {
  const knownSublistIds = new Set(sublists.map((sublist) => sublist.id));
  const examples = buildTrainingExamples(todos, samples, knownSublistIds);
  const categories = new Set(examples.map((example) => example.sublistId));

  if (examples.length < MIN_TOTAL_EXAMPLES || categories.size < MIN_CATEGORIES) {
    return null;
  }

  const normalizedText = normalizeItemText(text);
  const exactMatch = classifyExact(normalizedText, examples);
  if (exactMatch) {
    return exactMatch;
  }

  const tokens = tokenizeItemText(text);
  if (tokens.length === 0) {
    return null;
  }

  return classifyTokens(tokens, examples);
}

function buildTrainingExamples(
  todos: ClassificationTodo[],
  samples: ClassificationSample[],
  knownSublistIds: Set<string>,
): TrainingExample[] {
  const todoExamples = todos
    .filter((todo) => todo.sublist?.id && knownSublistIds.has(todo.sublist.id))
    .map((todo) => toTrainingExample(todo.text, todo.sublist!.id));

  const sampleExamples = samples
    .filter((sample) => sample.source !== "auto")
    .filter((sample) => sample.sublist?.id && knownSublistIds.has(sample.sublist.id))
    .map((sample) => toTrainingExample(sample.normalizedText || sample.text, sample.sublist!.id, true));

  return [...todoExamples, ...sampleExamples].filter((example) => example.tokens.length > 0);
}

function toTrainingExample(text: string, sublistId: string, alreadyNormalized = false): TrainingExample {
  const normalizedText = alreadyNormalized ? text : normalizeItemText(text);

  return {
    normalizedText,
    tokens: tokenizeItemText(normalizedText),
    sublistId,
  };
}

function classifyExact(
  normalizedText: string,
  examples: TrainingExample[],
): ClassificationResult | null {
  const counts = new Map<string, number>();
  let totalMatches = 0;

  for (const example of examples) {
    if (example.normalizedText !== normalizedText) continue;
    counts.set(example.sublistId, (counts.get(example.sublistId) || 0) + 1);
    totalMatches += 1;
  }

  if (totalMatches === 0) {
    return null;
  }

  const [sublistId, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = count / totalMatches;

  if (confidence < MIN_EXACT_CONFIDENCE) {
    return null;
  }

  return {
    sublistId,
    confidence,
    reason: "exact",
  };
}

function classifyTokens(tokens: string[], examples: TrainingExample[]): ClassificationResult | null {
  const vocabulary = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const tokenCounts = new Map<string, Map<string, number>>();
  const totalTokensByCategory = new Map<string, number>();

  for (const example of examples) {
    categoryCounts.set(example.sublistId, (categoryCounts.get(example.sublistId) || 0) + 1);

    const categoryTokenCounts = tokenCounts.get(example.sublistId) || new Map<string, number>();
    for (const token of example.tokens) {
      vocabulary.add(token);
      categoryTokenCounts.set(token, (categoryTokenCounts.get(token) || 0) + 1);
      totalTokensByCategory.set(example.sublistId, (totalTokensByCategory.get(example.sublistId) || 0) + 1);
    }
    tokenCounts.set(example.sublistId, categoryTokenCounts);
  }

  const vocabularySize = Math.max(1, vocabulary.size);
  const totalExamples = examples.length;
  const scores = [...categoryCounts.keys()].map((sublistId) => {
    const categoryTokenCounts = tokenCounts.get(sublistId) || new Map<string, number>();
    const totalCategoryTokens = totalTokensByCategory.get(sublistId) || 0;
    let score = Math.log((categoryCounts.get(sublistId) || 0) / totalExamples);

    for (const token of tokens) {
      const tokenCount = categoryTokenCounts.get(token) || 0;
      score += Math.log((tokenCount + 1) / (totalCategoryTokens + vocabularySize));
    }

    return { sublistId, score };
  });

  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || !second) {
    return null;
  }

  const confidence = 1 / (1 + Math.exp(second.score - best.score));
  if (confidence < MIN_TOKEN_CONFIDENCE) {
    return null;
  }

  return {
    sublistId: best.sublistId,
    confidence,
    reason: "tokens",
  };
}
