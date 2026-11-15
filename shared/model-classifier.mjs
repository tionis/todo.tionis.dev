// Sorting a new item with a chat model: the list's categories become lettered options, and the
// first answer token's log probabilities give a probability per option. The backend builds the
// request from options the browser sends (`backend/routes-classifier.mjs`), and the offline
// evaluation uses the same code (`lib/classifier-eval-models.ts`), so it measures what runs.
//
// An option: { id, name, parent?, keywords?, examples? } — the category's own name, its parent
// path ("EDEKA" or "ALDI/Kühlregal"), its classifier keywords and items sorted there before.

export const MODEL_CLASSIFIER_INSTRUCTIONS = [
  "This is an item on a household shopping list, usually in German.",
  "The list is sorted by where things are found while shopping: each option is an aisle or",
  "section of a supermarket, or a separate store for things the main store does not carry.",
  "Pick the option where this item is most likely bought. Use the option's description and",
  "the example items that were sorted there before.",
].join(" ");

/** Chosen on the evaluation before looking at the results; see README "Classifier evaluation". */
export const MODEL_CLASSIFIER_THRESHOLDS = Object.freeze({ auto: 0.8, suggest: 0.5 });

export const MODEL_CLASSIFIER_LIMITS = Object.freeze({
  item: 200,
  options: 26,
  name: 100,
  parent: 200,
  keywords: 20,
  examples: 8,
  word: 80,
  instructions: 2000,
});

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** `Section "Käse"; in "ALDI / Kühlregal"; typical items: …; sorted here before: …` */
export function describeOption(option) {
  const parts = [`Section "${option.name}"`];
  if (option.parent) parts.push(`in "${option.parent.split("/").join(" / ")}"`);
  if (option.keywords?.length) parts.push(`typical items: ${option.keywords.join(", ")}`);
  if (option.examples?.length) parts.push(`sorted here before: ${option.examples.join(", ")}`);
  return parts.join("; ");
}

/**
 * The chat completion request. The options come first and the item last, so requests for one
 * list share their prefix (local servers and hosted prompt caches reuse it), and the model
 * reads the item last, which the evaluation found more accurate.
 */
export function buildChoiceRequest({ model, item, options, instructions }) {
  const used = options.slice(0, LETTERS.length);
  const letters = new Map(used.map((option, index) => [LETTERS[index], option.id]));
  const lines = used.map((option, index) => `${LETTERS[index]}) ${describeOption(option)}`);
  const steering = typeof instructions === "string" ? instructions.trim() : "";
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
        {
          role: "system",
          content: [
            MODEL_CLASSIFIER_INSTRUCTIONS,
            steering ? `How this household sorts:\n${steering}` : "",
            "Answer with the letter of one option and nothing else.",
          ].filter(Boolean).join("\n\n"),
        },
        { role: "user", content: `Options:\n${lines.join("\n")}\n\nItem: ${item}` },
      ],
    },
  };
}

/** Probability per option letter from the first token's alternatives, renormalised; null without logprobs. */
export function letterProbabilities(response, letters) {
  const first = response?.choices?.[0]?.logprobs?.content?.[0];
  if (!first) return null;
  const candidates = first.top_logprobs?.length ? first.top_logprobs : [first];
  const probabilities = new Map();
  for (const { token, logprob } of candidates) {
    if (typeof token !== "string" || typeof logprob !== "number") continue;
    const letter = token.trim().replace(/[).:]$/, "").toUpperCase();
    if (!letters.has(letter)) continue;
    probabilities.set(letter, (probabilities.get(letter) ?? 0) + Math.exp(logprob));
  }
  const total = [...probabilities.values()].reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  for (const [letter, value] of probabilities) probabilities.set(letter, value / total);
  return probabilities;
}

/** The answer letter when the server returned no log probabilities. */
export function answerLetter(response, letters) {
  const content = response?.choices?.[0]?.message?.content;
  const letter = typeof content === "string" ? content.trim().charAt(0).toUpperCase() : "";
  return letters.has(letter) ? letter : null;
}

const isText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isTextList = (value, count, max) => value === undefined
  || (Array.isArray(value) && value.length <= count && value.every((entry) => isText(entry, max)));

/** Checks a classify request from the browser; returns an error message or null. */
export function invalidClassifyRequest(body) {
  const limits = MODEL_CLASSIFIER_LIMITS;
  if (!body || typeof body !== "object") return "Request body is required";
  if (!isText(body.item, limits.item)) return "Item text is required";
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > limits.options) {
    return `Between 2 and ${limits.options} options are required`;
  }
  const ids = new Set();
  for (const option of body.options) {
    if (!option || typeof option !== "object" || !isText(option.id, 100) || ids.has(option.id)) return "Invalid option id";
    ids.add(option.id);
    if (!isText(option.name, limits.name)) return "Invalid option name";
    if (option.parent !== undefined && option.parent !== null && !isText(option.parent, limits.parent)) return "Invalid option parent";
    if (!isTextList(option.keywords, limits.keywords, limits.word)) return "Invalid option keywords";
    if (!isTextList(option.examples, limits.examples, limits.word)) return "Invalid option examples";
  }
  return null;
}
