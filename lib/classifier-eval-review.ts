// A review sheet for the classifier evaluation: the events where a method disagrees with the
// recorded label, or where the label may be the classifier's own uncorrected guess. A person
// fills in the verdict column, and the evaluation then scores against the verdicts
// (`--verdicts`), since a list's history contains wrong placements nobody bothered to fix.
//
// Verdict column:
//   (empty)         not reviewed: the label stands
//   ok              the label is right
//   <category>      this category is right (a unique prefix of its name is enough)
//   <cat> | <cat>   any of these is right (e.g. a drink bought at either store)
//   skip            leave the event out (unclear, or not worth scoring)
import { eventKey, type EvalCategory, type LabelEvent, type MethodReport, type Verdicts } from "./classifier-eval";

const HEADER = ["key", "date", "item", "label", "label trusted", "methods", "verdict"];

function csvField(value: string): string {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Minimal RFC 4180 parsing: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

/** Rows for every scored event a method got "wrong", or whose label isn't trusted. */
export function buildReviewSheet(reports: MethodReport[], categories: EvalCategory[]): string {
  const name = new Map(categories.map((category) => [category.id, category.name]));
  const lines = [HEADER.join(",")];
  const [first] = reports;
  if (!first) return `${lines[0]}\n`;
  first.results.forEach(({ event }, index) => {
    const predictions = reports.map((report) => ({ method: report.method, prediction: report.results[index].prediction }));
    const disagreement = predictions.some(({ prediction }) => !prediction || !event.acceptable.includes(prediction.categoryId));
    if (!disagreement && event.trusted) return;
    const methods = predictions
      .map(({ method, prediction }) => prediction
        ? `${method}: ${name.get(prediction.categoryId) ?? prediction.categoryId} ${Math.round(prediction.confidence * 100)}%${prediction.auto ? " auto" : ""}`
        : `${method}: –`)
      .join("; ");
    lines.push([
      eventKey(event),
      new Date(event.at).toISOString().slice(0, 10),
      event.text,
      event.acceptable.map((id) => name.get(id) ?? id).join(" | "),
      event.trusted ? "yes" : "no",
      methods,
      "",
    ].map(csvField).join(","));
  });
  return `${lines.join("\n")}\n`;
}

/** Finds a category by its name or a unique case-insensitive prefix of it. */
function resolveCategory(text: string, categories: EvalCategory[]): string {
  const wanted = text.trim().toLocaleLowerCase();
  const exact = categories.filter((category) => category.name.toLocaleLowerCase() === wanted);
  const matches = exact.length ? exact : categories.filter((category) => category.name.toLocaleLowerCase().startsWith(wanted));
  if (matches.length !== 1) {
    throw new Error(`"${text.trim()}" ${matches.length ? `matches ${matches.map((category) => category.name).join(", ")}` : "matches no category"}`);
  }
  return matches[0].id;
}

/** Reads a filled-in review sheet. Rows without a verdict are not reviewed and left out. */
export function parseVerdicts(text: string, categories: EvalCategory[], events: LabelEvent[]): Verdicts {
  const [header, ...rows] = parseCsv(text);
  const keyColumn = header?.indexOf("key") ?? -1;
  const verdictColumn = header?.indexOf("verdict") ?? -1;
  if (keyColumn < 0 || verdictColumn < 0) throw new Error("The review sheet needs a key and a verdict column");
  const byKey = new Map(events.map((event) => [eventKey(event), event]));
  const verdicts: Verdicts = new Map();
  rows.forEach((row, index) => {
    const key = row[keyColumn]?.trim();
    const verdict = (row[verdictColumn] ?? "").trim();
    if (!key || !verdict) return;
    const event = byKey.get(key);
    if (!event) throw new Error(`Row ${index + 2}: no event ${key} in this export`);
    try {
      if (/^skip$/i.test(verdict)) verdicts.set(key, null);
      else if (/^ok$/i.test(verdict)) verdicts.set(key, event.acceptable);
      else verdicts.set(key, verdict.split("|").map((part) => resolveCategory(part, categories)));
    } catch (error) {
      throw new Error(`Row ${index + 2} (${event.text}): ${error instanceof Error ? error.message : error}`);
    }
  });
  return verdicts;
}
