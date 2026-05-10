export interface ClassificationSublist {
  id: string;
  name: string;
  classifierKeywords?: string | null;
}

export interface ClassificationTodo {
  text: string;
  done?: boolean;
  createdAt?: string | number;
  updatedAt?: string | number | null;
  sublist?: { id: string } | null;
}

export interface ClassificationSample {
  text: string;
  normalizedText?: string;
  source?: string;
  createdAt?: string | number;
  sublist?: { id: string } | null;
}

export type ClassifierAggressiveness = "conservative" | "normal" | "aggressive";

export interface ClassificationOptions {
  aggressiveness?: ClassifierAggressiveness | string | null;
}

export interface ClassificationCandidate {
  sublistId: string;
  confidence: number;
  reason: "exact" | "tokens" | "fuzzy";
  score: number;
}

export interface ClassificationResult {
  sublistId: string;
  confidence: number;
  reason: "exact" | "tokens" | "fuzzy";
  candidates: ClassificationCandidate[];
}

export interface ClassifierCategoryStatus {
  sublistId: string;
  count: number;
}

export interface ClassifierStatus {
  ready: boolean;
  totalExamples: number;
  completedExamples: number;
  fallbackExamples: number;
  keywordExamples: number;
  negativeExamples: number;
  categoryCount: number;
  requiredExamples: number;
  requiredCategories: number;
  sourceCounts: Record<string, number>;
  categoryCounts: ClassifierCategoryStatus[];
  missingReason: string | null;
  evaluation: ClassifierEvaluation;
}

export interface ClassifierEvaluation {
  tested: number;
  correct: number;
  accuracy: number | null;
}

interface TrainingExample {
  normalizedText: string;
  tokens: string[];
  sublistId: string;
  source: string;
  createdAt: string | number;
}

interface ClassifierModel {
  positiveExamples: TrainingExample[];
  negativeExamples: TrainingExample[];
  sourceCounts: Record<string, number>;
  completedExamples: number;
  fallbackExamples: number;
  keywordExamples: number;
}

interface ClassifierThresholds {
  fuzzyScore: number;
  fuzzyConfidence: number;
  fuzzyMargin: number;
  suggestionConfidence: number;
  autoConfidence: number;
}

const MIN_TOTAL_EXAMPLES = 4;
const MIN_CATEGORIES = 2;
const MIN_EXACT_CONFIDENCE = 0.75;
const MIN_TOKEN_SIMILARITY = 0.72;
const FUZZY_TOP_EXAMPLES = 4;
const CLASSIFIER_THRESHOLDS: Record<ClassifierAggressiveness, ClassifierThresholds> = {
  conservative: {
    fuzzyScore: 0.66,
    fuzzyConfidence: 0.68,
    fuzzyMargin: 0.18,
    suggestionConfidence: 0.64,
    autoConfidence: 0.86,
  },
  normal: {
    fuzzyScore: 0.58,
    fuzzyConfidence: 0.62,
    fuzzyMargin: 0.14,
    suggestionConfidence: 0.58,
    autoConfidence: 0.78,
  },
  aggressive: {
    fuzzyScore: 0.5,
    fuzzyConfidence: 0.56,
    fuzzyMargin: 0.08,
    suggestionConfidence: 0.5,
    autoConfidence: 0.68,
  },
};
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
  options: ClassificationOptions = {},
): ClassificationResult | null {
  const knownSublistIds = new Set(sublists.map((sublist) => sublist.id));
  const model = buildClassifierModel(sublists, todos, samples, knownSublistIds);
  const categories = new Set(model.positiveExamples.map((example) => example.sublistId));

  if (model.positiveExamples.length < MIN_TOTAL_EXAMPLES || categories.size < MIN_CATEGORIES) {
    return null;
  }

  const thresholds = getClassifierThresholds(options.aggressiveness);
  const normalizedText = normalizeItemText(text);
  const tokens = expandTokensWithVocabulary(tokenizeItemText(text), model.positiveExamples);
  if (tokens.length === 0) {
    return null;
  }

  const exactMatch = classifyExact(normalizedText, model);
  if (exactMatch) {
    return exactMatch;
  }

  const candidates = mergeCandidates([
    ...getTokenCandidates(tokens, model, thresholds),
    ...getFuzzyCandidates(normalizedText, tokens, model, thresholds),
  ]);
  const [best] = candidates;
  if (!best || best.confidence < thresholds.suggestionConfidence) {
    return null;
  }

  return {
    sublistId: best.sublistId,
    confidence: best.confidence,
    reason: best.reason,
    candidates,
  };
}

export function getClassificationCandidates(
  text: string,
  sublists: ClassificationSublist[],
  todos: ClassificationTodo[],
  samples: ClassificationSample[] = [],
  options: ClassificationOptions = {},
): ClassificationCandidate[] {
  const knownSublistIds = new Set(sublists.map((sublist) => sublist.id));
  const model = buildClassifierModel(sublists, todos, samples, knownSublistIds);
  const categories = new Set(model.positiveExamples.map((example) => example.sublistId));

  if (model.positiveExamples.length < MIN_TOTAL_EXAMPLES || categories.size < MIN_CATEGORIES) {
    return [];
  }

  const normalizedText = normalizeItemText(text);
  const tokens = expandTokensWithVocabulary(tokenizeItemText(text), model.positiveExamples);
  if (tokens.length === 0) {
    return [];
  }

  const thresholds = getClassifierThresholds(options.aggressiveness);
  const exactMatch = classifyExact(normalizedText, model);
  if (exactMatch) {
    return exactMatch.candidates;
  }

  return mergeCandidates([
    ...getTokenCandidates(tokens, model, thresholds),
    ...getFuzzyCandidates(normalizedText, tokens, model, thresholds),
  ]);
}

function mergeCandidates(candidates: ClassificationCandidate[]): ClassificationCandidate[] {
  const mergedCandidates = new Map<string, ClassificationCandidate>();

  for (const candidate of candidates) {
    const existing = mergedCandidates.get(candidate.sublistId);
    if (!existing || candidate.confidence > existing.confidence) {
      mergedCandidates.set(candidate.sublistId, candidate);
    }
  }

  return [...mergedCandidates.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

export function shouldAutoSortClassification(
  result: ClassificationResult | null,
  options: ClassificationOptions = {},
): boolean {
  if (!result) {
    return false;
  }

  const thresholds = getClassifierThresholds(options.aggressiveness);
  return result.reason === "exact"
    ? result.confidence >= MIN_EXACT_CONFIDENCE
    : result.confidence >= thresholds.autoConfidence;
}

export function shouldSuggestClassification(
  result: ClassificationResult | null,
  options: ClassificationOptions = {},
): boolean {
  if (!result) {
    return false;
  }

  const thresholds = getClassifierThresholds(options.aggressiveness);
  return result.confidence >= thresholds.suggestionConfidence;
}

export function getClassifierStatus(
  sublists: ClassificationSublist[],
  todos: ClassificationTodo[],
  samples: ClassificationSample[] = [],
  options: ClassificationOptions = {},
): ClassifierStatus {
  const knownSublistIds = new Set(sublists.map((sublist) => sublist.id));
  const model = buildClassifierModel(sublists, todos, samples, knownSublistIds);
  const examples = model.positiveExamples;
  const categories = new Set(examples.map((example) => example.sublistId));
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
    completedExamples: model.completedExamples,
    fallbackExamples: model.fallbackExamples,
    keywordExamples: model.keywordExamples,
    negativeExamples: model.negativeExamples.length,
    categoryCount: categories.size,
    requiredExamples: MIN_TOTAL_EXAMPLES,
    requiredCategories: MIN_CATEGORIES,
    sourceCounts: model.sourceCounts,
    categoryCounts: [...categoryCountMap.entries()]
      .map(([sublistId, count]) => ({ sublistId, count }))
      .sort((a, b) => b.count - a.count),
    missingReason,
    evaluation: evaluateClassifierModel(model, options),
  };
}

function buildClassifierModel(
  sublists: ClassificationSublist[],
  todos: ClassificationTodo[],
  samples: ClassificationSample[],
  knownSublistIds: Set<string>,
): ClassifierModel {
  const completedExamplesByText = new Map<string, TrainingExample>();
  const fallbackExamplesByText = new Map<string, TrainingExample>();
  const negativeExamples: TrainingExample[] = [];
  const keywordExamples = sublists.flatMap((sublist) => keywordTrainingExamples(sublist));
  const sourceCounts: Record<string, number> = {};

  for (const todo of todos) {
    if (!todo.done || !todo.sublist?.id || !knownSublistIds.has(todo.sublist.id)) continue;
    const example = toTrainingExample(todo.text, todo.sublist.id, false, "checked-todo", todo.updatedAt || todo.createdAt);
    if (!example) continue;
    sourceCounts["checked-todo"] = (sourceCounts["checked-todo"] || 0) + 1;
    setLatestExample(completedExamplesByText, example);
  }

  for (const sample of samples) {
    const source = sample.source || "unknown";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    if (!sample.sublist?.id || !knownSublistIds.has(sample.sublist.id)) continue;

    const example = toTrainingExample(
      sample.normalizedText || sample.text,
      sample.sublist.id,
      !!sample.normalizedText,
      source,
      sample.createdAt,
    );
    if (!example) continue;

    if (source === "negative") {
      negativeExamples.push(example);
    } else if (source === "checked") {
      setLatestExample(completedExamplesByText, example);
    } else if (source !== "auto") {
      setLatestExample(fallbackExamplesByText, example);
    }
  }

  const completedExamples = [...completedExamplesByText.values()];
  const fallbackExamples = [...fallbackExamplesByText.entries()]
    .filter(([normalizedText]) => !completedExamplesByText.has(normalizedText))
    .map(([, example]) => example);
  const positiveExamples = [...completedExamples, ...fallbackExamples, ...keywordExamples]
    .map((example) => ({
      ...example,
      tokens: expandTokensWithVocabulary(example.tokens, [...completedExamples, ...fallbackExamples, ...keywordExamples]),
    }))
    .filter((example) => example.tokens.length > 0);
  if (keywordExamples.length > 0) {
    sourceCounts.keyword = keywordExamples.length;
  }

  return {
    positiveExamples,
    negativeExamples,
    sourceCounts,
    completedExamples: completedExamples.length,
    fallbackExamples: fallbackExamples.length,
    keywordExamples: keywordExamples.length,
  };
}

function toTrainingExample(
  text: string,
  sublistId: string,
  alreadyNormalized = false,
  source = "unknown",
  createdAt?: string | number | null,
): TrainingExample | null {
  const normalizedText = alreadyNormalized ? text : normalizeItemText(text);
  const tokens = tokenizeItemText(normalizedText);
  if (!normalizedText || tokens.length === 0) {
    return null;
  }

  return {
    normalizedText,
    tokens,
    sublistId,
    source,
    createdAt: createdAt || "",
  };
}

function keywordTrainingExamples(sublist: ClassificationSublist): TrainingExample[] {
  return parseClassifierKeywords(sublist.classifierKeywords)
    .map((keyword) => toTrainingExample(keyword, sublist.id, false, "keyword"))
    .filter((example): example is TrainingExample => !!example);
}

function setLatestExample(examplesByText: Map<string, TrainingExample>, example: TrainingExample): void {
  const existing = examplesByText.get(example.normalizedText);
  if (!existing || timestampValue(example.createdAt) >= timestampValue(existing.createdAt)) {
    examplesByText.set(example.normalizedText, example);
  }
}

function timestampValue(value?: string | number): number {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function parseClassifierKeywords(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(
    value
      .split(/[\n,]/)
      .map((keyword) => keyword.trim())
      .filter(Boolean)
  )];
}

function classifyExact(
  normalizedText: string,
  model: ClassifierModel,
): ClassificationResult | null {
  const counts = new Map<string, number>();
  let totalMatches = 0;

  for (const example of model.positiveExamples) {
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
    candidates: [...counts.entries()]
      .map(([candidateSublistId, candidateCount]) => ({
        sublistId: candidateSublistId,
        confidence: candidateCount / totalMatches,
        reason: "exact" as const,
        score: candidateCount,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3),
  };
}

function getTokenCandidates(
  tokens: string[],
  model: ClassifierModel,
  thresholds: ClassifierThresholds,
): ClassificationCandidate[] {
  const examples = model.positiveExamples;
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
  return scores
    .map((score, index) => {
      const secondBest = index === 0 ? scores[1] : scores[0];
      const confidence = secondBest
        ? 1 / (1 + Math.exp(secondBest.score - score.score))
        : 1;

      return {
        sublistId: score.sublistId,
        confidence: adjustConfidenceForNegatives(confidence, tokens, score.sublistId, model),
        reason: "tokens" as const,
        score: score.score,
      };
    })
    .filter((candidate) => candidate.confidence >= thresholds.suggestionConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

function getFuzzyCandidates(
  normalizedText: string,
  tokens: string[],
  model: ClassifierModel,
  thresholds: ClassifierThresholds,
): ClassificationCandidate[] {
  const categoryScores = new Map<string, number[]>();

  for (const example of model.positiveExamples) {
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

  return ranked
    .map((candidate, index) => {
      const secondBest = index === 0 ? ranked[1] : ranked[0];
      const secondScore = secondBest?.score || 0;
      const confidence = secondScore === 0
        ? candidate.score
        : candidate.score / (candidate.score + secondScore);
      const adjustedConfidence = adjustConfidenceForNegatives(
        Math.min(0.99, Math.max(confidence, candidate.score)),
        tokens,
        candidate.sublistId,
        model,
      );
      const margin = candidate.score - secondScore;

      return {
        sublistId: candidate.sublistId,
        confidence: adjustedConfidence,
        reason: "fuzzy" as const,
        score: candidate.score,
        accepted: candidate.score >= thresholds.fuzzyScore
          && (!secondBest || adjustedConfidence >= thresholds.fuzzyConfidence || margin >= thresholds.fuzzyMargin),
      };
    })
    .filter((candidate) => candidate.accepted || candidate.confidence >= thresholds.suggestionConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map(({ accepted: _accepted, ...candidate }) => candidate);
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

function adjustConfidenceForNegatives(
  confidence: number,
  tokens: string[],
  sublistId: string,
  model: ClassifierModel,
): number {
  const strongestNegativeMatch = model.negativeExamples
    .filter((example) => example.sublistId === sublistId)
    .reduce((score, example) => Math.max(score, softTokenSimilarity(tokens, example.tokens)), 0);

  if (strongestNegativeMatch < 0.55) {
    return confidence;
  }

  return confidence * Math.max(0.1, 1 - strongestNegativeMatch * 0.75);
}

function expandTokensWithVocabulary(tokens: string[], examples: TrainingExample[]): string[] {
  const vocabulary = new Set(examples.flatMap((example) => example.tokens));
  const expandedTokens = new Set(tokens);

  for (const token of tokens) {
    if (token.length < 6) continue;

    for (const knownToken of vocabulary) {
      if (knownToken.length < 4 || knownToken === token) continue;
      if (token.includes(knownToken) || knownToken.includes(token)) {
        expandedTokens.add(knownToken);
      }
    }
  }

  return [...expandedTokens];
}

function evaluateClassifierModel(
  model: ClassifierModel,
  options: ClassificationOptions,
): ClassifierEvaluation {
  const evaluationExamples = model.positiveExamples
    .filter((example) => example.source !== "keyword")
    .slice(0, 80);
  let tested = 0;
  let correct = 0;

  for (const example of evaluationExamples) {
    const trainingExamples = model.positiveExamples.filter((candidate) => candidate !== example);
    const categories = new Set(trainingExamples.map((candidate) => candidate.sublistId));
    if (trainingExamples.length < MIN_TOTAL_EXAMPLES || categories.size < MIN_CATEGORIES) continue;

    const result = classifyWithModel(example.normalizedText, {
      ...model,
      positiveExamples: trainingExamples,
    }, options);

    tested += 1;
    if (result?.sublistId === example.sublistId) {
      correct += 1;
    }
  }

  return {
    tested,
    correct,
    accuracy: tested === 0 ? null : correct / tested,
  };
}

function classifyWithModel(
  text: string,
  model: ClassifierModel,
  options: ClassificationOptions,
): ClassificationResult | null {
  const normalizedText = normalizeItemText(text);
  const tokens = expandTokensWithVocabulary(tokenizeItemText(text), model.positiveExamples);
  if (tokens.length === 0) {
    return null;
  }

  const thresholds = getClassifierThresholds(options.aggressiveness);
  const exactMatch = classifyExact(normalizedText, model);
  if (exactMatch) {
    return exactMatch;
  }

  const candidates = mergeCandidates([
    ...getTokenCandidates(tokens, model, thresholds),
    ...getFuzzyCandidates(normalizedText, tokens, model, thresholds),
  ]);
  const [best] = candidates;
  if (!best || best.confidence < thresholds.suggestionConfidence) {
    return null;
  }

  return {
    sublistId: best.sublistId,
    confidence: best.confidence,
    reason: best.reason,
    candidates,
  };
}

function getClassifierThresholds(aggressiveness: ClassificationOptions["aggressiveness"]): ClassifierThresholds {
  if (aggressiveness === "conservative" || aggressiveness === "aggressive") {
    return CLASSIFIER_THRESHOLDS[aggressiveness];
  }

  return CLASSIFIER_THRESHOLDS.normal;
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
