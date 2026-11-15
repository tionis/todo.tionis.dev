import { NOT_HANDLED } from "./route-result.mjs";
import crypto from "node:crypto";
import { fail, json, readJson, safeDecode } from "./http-helpers.mjs";
import { createFixedWindowRateLimiter } from "./rate-limit.mjs";
import {
  MODEL_CLASSIFIER_THRESHOLDS,
  answerLetter,
  buildChoiceRequest,
  invalidClassifyRequest,
  letterProbabilities,
} from "../shared/model-classifier.mjs";

export const MODEL_CACHE_TTL_MS = 30 * 86_400_000;

// Sorting a new item with a chat model (POST /api/lists/:id/classify). The browser sends the
// item and the list's categories as options (it has the document); the server adds the list's
// steering text, asks the model configured by CLASSIFIER_MODEL_* and answers with a probability
// per category. Answers are cached by request, so a repeated item costs nothing; failures
// answer 503 and the browser falls back to its local classifier.
// A handler answers the request and returns, or returns NOT_HANDLED so the next group can try.
export function createRoutesClassifier(ctx) {
  const { config, database, requireUser, trustedMutation, listRowById, accessFor } = ctx;
  const model = config.modelClassifier;
  // Each request may cost money: a person adds a few items a minute, not hundreds.
  const allowRequest = createFixedWindowRateLimiter({ limit: 60, windowMs: 60_000 });

  async function askModel(body) {
    const response = await fetch(`${model.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(model.timeoutMs),
    });
    if (!response.ok) throw new Error(`Model server answered ${response.status}`);
    return response.json();
  }

  return async function handle(request, response, url) {
    const match = url.pathname.match(/^\/api\/lists\/([^/]+)\/classify$/);
    if (!match || request.method !== "POST") return NOT_HANDLED;
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const row = listRowById(safeDecode(match[1]));
    if (!accessFor(row, user).write) return fail(response, row ? 403 : 404, row ? "List is read-only" : "List not found");
    if (!model) return fail(response, 503, "Sorting with a model is not configured on this server");
    if (!row.classifier_model) return fail(response, 409, "Sorting with a model is off for this list");
    const body = await readJson(request, 64_000);
    const invalid = invalidClassifyRequest(body);
    if (invalid) return fail(response, 400, invalid);
    const { letters, body: modelRequest } = buildChoiceRequest({
      model: model.model,
      item: body.item.trim(),
      options: body.options,
      instructions: row.classifier_instructions || "",
    });
    // The request names no ids, only descriptions: the cache holds letters, mapped per request.
    const key = crypto.createHash("sha256").update(JSON.stringify(modelRequest)).digest("hex");
    const cached = database.prepare("SELECT probabilities FROM model_classifier_cache WHERE key = ? AND created_at > ?")
      .get(key, Date.now() - MODEL_CACHE_TTL_MS);
    let byLetter = cached ? JSON.parse(cached.probabilities) : null;
    if (!byLetter) {
      // Only requests that reach the model count: a cached answer costs nothing.
      if (!allowRequest(user.id)) {
        response.setHeader("Retry-After", "60");
        return fail(response, 429, "Too many items to sort; slow down");
      }
      let answer;
      try {
        answer = await askModel(modelRequest);
      } catch (error) {
        console.warn(`Model classifier failed: ${error.message}`);
        return fail(response, 503, "The model could not be reached");
      }
      const probabilities = letterProbabilities(answer, letters);
      const letter = probabilities ? null : answerLetter(answer, letters);
      if (!probabilities && !letter) return fail(response, 503, "The model gave no usable answer");
      // Without log probabilities only the answer is known: it may be suggested, never auto-sorted.
      byLetter = probabilities ? Object.fromEntries(probabilities) : { [letter]: MODEL_CLASSIFIER_THRESHOLDS.suggest };
      database.prepare("INSERT OR REPLACE INTO model_classifier_cache (key, probabilities, created_at) VALUES (?, ?, ?)")
        .run(key, JSON.stringify(byLetter), Date.now());
    }
    const probabilities = Object.fromEntries(Object.entries(byLetter)
      .filter(([letter]) => letters.has(letter))
      .map(([letter, value]) => [letters.get(letter), value])
      .sort((a, b) => b[1] - a[1]));
    json(response, 200, { probabilities, model: model.model, cached: !!cached });
  };
}
