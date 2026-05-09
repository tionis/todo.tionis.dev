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
  reason: "exact" | "tokens" | "fuzzy";
}

export interface ClassifierCategoryStatus {
  sublistId: string;
  count: number;
}

export interface ClassifierStatus {
  ready: boolean;
  totalExamples: number;
  categoryCount: number;
  requiredExamples: number;
  requiredCategories: number;
  sourceCounts: Record<string, number>;
  categoryCounts: ClassifierCategoryStatus[];
  missingReason: string | null;
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
const MIN_FUZZY_SCORE = 0.58;
const MIN_FUZZY_CONFIDENCE = 0.62;
const MIN_FUZZY_MARGIN = 0.14;
const MIN_TOKEN_SIMILARITY = 0.72;
const FUZZY_TOP_EXAMPLES = 4;
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
  const tokens = normalizeItemText(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token) && !UNIT_WORDS.has(token));

  return [...new Set(tokens.flatMap((token) => [token, stemToken(token)]))];
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

  const tokenMatch = classifyTokens(tokens, examples);
  if (tokenMatch) {
    return tokenMatch;
  }

  return classifyFuzzy(normalizedText, tokens, examples);
}

export function getClassifierStatus(
  sublists: ClassificationSublist[],
  todos: ClassificationTodo[],
  samples: ClassificationSample[] = [],
): ClassifierStatus {
  const knownSublistIds = new Set(sublists.map((sublist) => sublist.id));
  const examples = buildTrainingExamples(todos, samples, knownSublistIds);
  const categories = new Set(examples.map((example) => example.sublistId));
  const sourceCounts = samples.reduce<Record<string, number>>((counts, sample) => {
    const source = sample.source || "unknown";
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});
  const categoryCountMap = examples.reduce<Map<string, number>>((counts, example) => {
    counts.set(example.sublistId, (counts.get(example.sublistId) || 0) + 1);
    return counts;
  }, new Map());
  const ready = examples.length >= MIN_TOTAL_EXAMPLES && categories.size >= MIN_CATEGORIES;
  const missingReason = ready
    ? null
    : `Needs at least ${MIN_TOTAL_EXAMPLES} categorized examples across ${MIN_CATEGORIES} categories.`;

  return {
    ready,
    totalExamples: examples.length,
    categoryCount: categories.size,
    requiredExamples: MIN_TOTAL_EXAMPLES,
    requiredCategories: MIN_CATEGORIES,
    sourceCounts,
    categoryCounts: [...categoryCountMap.entries()]
      .map(([sublistId, count]) => ({ sublistId, count }))
      .sort((a, b) => b.count - a.count),
    missingReason,
  };
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

function classifyFuzzy(
  normalizedText: string,
  tokens: string[],
  examples: TrainingExample[],
): ClassificationResult | null {
  const categoryScores = new Map<string, number[]>();

  for (const example of examples) {
    const score = compareExamples(normalizedText, tokens, example);
    if (score <= 0) continue;

    const scores = categoryScores.get(example.sublistId) || [];
    scores.push(score);
    categoryScores.set(example.sublistId, scores);
  }

  const ranked = [...categoryScores.entries()]
    .map(([sublistId, scores]) => ({
      sublistId,
      score: combineTopScores(scores),
    }))
    .sort((a, b) => b.score - a.score);

  const [best, second] = ranked;
  if (!best || best.score < MIN_FUZZY_SCORE) {
    return null;
  }

  const secondScore = second?.score || 0;
  const confidence = secondScore === 0
    ? best.score
    : best.score / (best.score + secondScore);
  const margin = best.score - secondScore;

  if (second && confidence < MIN_FUZZY_CONFIDENCE && margin < MIN_FUZZY_MARGIN) {
    return null;
  }

  return {
    sublistId: best.sublistId,
    confidence: Math.min(0.99, Math.max(confidence, best.score)),
    reason: "fuzzy",
  };
}

function compareExamples(normalizedText: string, tokens: string[], example: TrainingExample): number {
  const tokenScore = softTokenSimilarity(tokens, example.tokens);
  const textScore = diceCoefficient(compactText(normalizedText), compactText(example.normalizedText));
  const containmentScore = containmentSimilarity(normalizedText, example.normalizedText);

  return Math.max(
    tokenScore * 0.7 + textScore * 0.3,
    containmentScore,
  );
}

function combineTopScores(scores: number[]): number {
  const [bestScore, ...supportScores] = [...scores].sort((a, b) => b - a).slice(0, FUZZY_TOP_EXAMPLES);
  if (bestScore === undefined) {
    return 0;
  }

  const weights = [0.7, 0.45, 0.25];
  const weightedSupportTotal = supportScores.reduce((total, score, index) => total + score * weights[index], 0);
  const supportWeightTotal = weights.slice(0, supportScores.length).reduce((total, weight) => total + weight, 0);
  const supportScore = supportWeightTotal === 0 ? 0 : weightedSupportTotal / supportWeightTotal;

  return Math.min(1, bestScore + supportScore * 0.15);
}

function softTokenSimilarity(leftTokens: string[], rightTokens: string[]): number {
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const availableRightTokens = [...rightTokens];
  let intersection = 0;

  for (const leftToken of leftTokens) {
    let bestIndex = -1;
    let bestScore = 0;

    for (let index = 0; index < availableRightTokens.length; index += 1) {
      const score = compareTokens(leftToken, availableRightTokens[index]);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0 && bestScore >= MIN_TOKEN_SIMILARITY) {
      intersection += bestScore;
      availableRightTokens.splice(bestIndex, 1);
    }
  }

  return intersection / (leftTokens.length + rightTokens.length - intersection);
}

function compareTokens(leftToken: string, rightToken: string): number {
  if (leftToken === rightToken) {
    return 1;
  }

  const shorter = leftToken.length <= rightToken.length ? leftToken : rightToken;
  const longer = leftToken.length > rightToken.length ? leftToken : rightToken;

  if (shorter.length >= 4 && longer.startsWith(shorter)) {
    return 0.9;
  }

  if (shorter.length >= 4 && longer.includes(shorter)) {
    return 0.82;
  }

  if (hasSingleAdjacentTransposition(leftToken, rightToken)) {
    return 0.88;
  }

  const maxLength = Math.max(leftToken.length, rightToken.length);
  if (maxLength < 4) {
    return 0;
  }

  const distance = levenshteinDistance(leftToken, rightToken);
  const similarity = 1 - distance / maxLength;

  return similarity >= MIN_TOKEN_SIMILARITY ? similarity : 0;
}

function containmentSimilarity(leftText: string, rightText: string): number {
  const left = compactText(leftText);
  const right = compactText(rightText);
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;

  if (shorter.length < 4 || !longer.includes(shorter)) {
    return 0;
  }

  return Math.max(0.58, shorter.length / longer.length);
}

function diceCoefficient(leftText: string, rightText: string): number {
  if (leftText === rightText) {
    return 1;
  }

  if (leftText.length < 3 || rightText.length < 3) {
    return 0;
  }

  const leftBigrams = countBigrams(leftText);
  const rightBigrams = countBigrams(rightText);
  let overlap = 0;

  for (const [bigram, leftCount] of leftBigrams.entries()) {
    overlap += Math.min(leftCount, rightBigrams.get(bigram) || 0);
  }

  const total = [...leftBigrams.values()].reduce((sum, count) => sum + count, 0)
    + [...rightBigrams.values()].reduce((sum, count) => sum + count, 0);

  return total === 0 ? 0 : (2 * overlap) / total;
}

function countBigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (let index = 0; index < text.length - 1; index += 1) {
    const bigram = text.slice(index, index + 2);
    counts.set(bigram, (counts.get(bigram) || 0) + 1);
  }

  return counts;
}

function levenshteinDistance(leftToken: string, rightToken: string): number {
  const previous = Array.from({ length: rightToken.length + 1 }, (_, index) => index);
  const current = Array.from({ length: rightToken.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= leftToken.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= rightToken.length; rightIndex += 1) {
      const substitutionCost = leftToken[leftIndex - 1] === rightToken[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[rightToken.length];
}

function hasSingleAdjacentTransposition(leftToken: string, rightToken: string): boolean {
  if (leftToken.length !== rightToken.length) {
    return false;
  }

  const mismatches: number[] = [];
  for (let index = 0; index < leftToken.length; index += 1) {
    if (leftToken[index] !== rightToken[index]) {
      mismatches.push(index);
    }
  }

  return mismatches.length === 2
    && mismatches[1] === mismatches[0] + 1
    && leftToken[mismatches[0]] === rightToken[mismatches[1]]
    && leftToken[mismatches[1]] === rightToken[mismatches[0]];
}

function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  const suffixes = ["innen", "chen", "ern", "en", "er", "es", "e", "n", "s"];

  for (const suffix of suffixes) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }

  return token;
}

function compactText(text: string): string {
  return text.replace(/\s+/g, "");
}
