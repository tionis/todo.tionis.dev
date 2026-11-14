// Replays a list export and scores classifiers against what people actually did
// (lib/classifier-eval.ts). Usage:
//
//   npm run eval:classifier -- <export.json> [--methods current,lookup-first,naive-bayes,jev,jev-fallback]
//                              [--max-requests 300] [--max-events N] [--json]
//
// `jev` and `jev-fallback` need AIMLAPI_KEY and send item texts and category names to AIMLAPI /
// TypeSafe. JEV_MODEL picks the model (default typesafe/jev-1.14), JEV_BASE_URL another
// endpoint (e.g. a local Laya server's /v1/systemone). Responses are cached in .cache/jev/.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  currentMethod,
  formatPercent,
  formatTable,
  jevFallbackMethod,
  jevMethod,
  lookupFirst,
  naiveBayesMethod,
  parseExport,
  replay,
  thresholdSweep,
  DEFAULT_JEV_THRESHOLDS,
  DEFAULT_NB_THRESHOLDS,
  type EvalMethod,
  type JevRequest,
  type JevResponse,
} from "../lib/classifier-eval";

function parseArgs(argv: string[]) {
  const args = { file: "", methods: ["current", "lookup-first", "naive-bayes"], maxRequests: 300, maxEvents: 0, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => argv[++index] ?? "";
    if (arg === "--methods") args.methods = value().split(",").map((name) => name.trim()).filter(Boolean);
    else if (arg === "--max-requests") args.maxRequests = Number(value());
    else if (arg === "--max-events") args.maxEvents = Number(value());
    else if (arg === "--json") args.json = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else args.file = arg;
  }
  if (!args.file) throw new Error("Usage: evaluate-classifier <export.json> [--methods …] [--max-requests N] [--max-events N] [--json]");
  return args;
}

function diskCache(directory: string) {
  const file = (request: JevRequest) => path.join(directory, `${createHash("sha256").update(JSON.stringify(request)).digest("hex")}.json`);
  return {
    async get(request: JevRequest) {
      try {
        return JSON.parse(await readFile(file(request), "utf8")) as JevResponse;
      } catch {
        return undefined;
      }
    },
    async set(request: JevRequest, response: JevResponse) {
      await mkdir(directory, { recursive: true });
      await writeFile(file(request), JSON.stringify(response));
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = parseExport(JSON.parse(await readFile(args.file, "utf8")));
  const wantsJev = args.methods.some((name) => name === "jev" || name === "jev-fallback");
  const apiKey = process.env.AIMLAPI_KEY;
  if (wantsJev && !apiKey) {
    console.error("AIMLAPI_KEY is not set: leaving out jev and jev-fallback.");
    args.methods = args.methods.filter((name) => name !== "jev" && name !== "jev-fallback");
  }
  const jev = apiKey && wantsJev
    ? jevMethod({
      apiKey,
      baseUrl: process.env.JEV_BASE_URL || undefined,
      model: process.env.JEV_MODEL || undefined,
      cache: diskCache(path.resolve(".cache/jev")),
      maxRequests: args.maxRequests,
    })
    : undefined;
  const available: Record<string, () => EvalMethod> = {
    current: () => currentMethod,
    "lookup-first": () => lookupFirst(currentMethod),
    "naive-bayes": () => naiveBayesMethod(),
    jev: () => jev!,
    "jev-fallback": () => jevFallbackMethod(jev!),
  };
  const methods = args.methods.map((name) => {
    if (!available[name]) throw new Error(`Unknown method ${name} (known: ${Object.keys(available).join(", ")})`);
    return available[name]();
  });

  const reports = await replay(data, methods, {
    maxEvents: args.maxEvents || undefined,
    onProgress: (done, total) => {
      if (process.stderr.isTTY && (done % 25 === 0 || done === total)) process.stderr.write(`\r${done}/${total} events`);
    },
  });
  if (process.stderr.isTTY) process.stderr.write("\n");

  const sweeps = Object.fromEntries(reports
    .filter((report) => report.method === "naive-bayes" || report.method === "jev")
    .map((report) => [report.method, thresholdSweep(report.results)]));

  if (args.json) {
    console.log(JSON.stringify({
      list: data.list.name,
      reports: reports.map(({ method, outcome, confusion }) => ({ method, outcome, confusion })),
      sweeps,
      jev: jev?.stats,
    }, null, 2));
    return;
  }

  console.log(`List: ${data.list.name ?? "?"}, ${data.categories.length} categories, ${data.classifierHistory.length} samples, ${data.todos.length} todos\n`);
  console.log(formatTable(reports));
  console.log("\nauto = sorted without asking; sugg = offered as a suggestion; top-1 = predicted category right at any confidence");
  console.log("(abstaining counts as wrong); cold = the item text had never been placed before.");
  console.log(`Thresholds: naive-bayes auto ≥ ${DEFAULT_NB_THRESHOLDS.auto}, suggest ≥ ${DEFAULT_NB_THRESHOLDS.suggest}; jev auto ≥ ${DEFAULT_JEV_THRESHOLDS.auto}, suggest ≥ ${DEFAULT_JEV_THRESHOLDS.suggest} (chosen up front).`);

  for (const [method, sweep] of Object.entries(sweeps)) {
    console.log(`\nThreshold sweep for ${method} (same predictions; picking the best row tunes on this data, so it is an upper bound):`);
    for (const { thresholds, outcome } of sweep) {
      const autoTotal = outcome.autoCorrect + outcome.autoWrong;
      console.log(`  auto ≥ ${thresholds.auto.toFixed(2)}: auto ${autoTotal} (wrong ${outcome.autoWrong}, precision ${formatPercent(autoTotal ? outcome.autoCorrect / autoTotal : null)}), suggested ${outcome.suggestCorrect + outcome.suggestWrong}, abstained ${outcome.abstained}`);
    }
  }

  for (const report of reports) {
    if (report.confusion.length === 0) continue;
    console.log(`\nWrong auto-sorts by ${report.method} (expected → predicted):`);
    for (const { expected, predicted, count } of report.confusion) console.log(`  ${count}× ${expected} → ${predicted}`);
  }

  if (jev) {
    const { requests, cached, skipped, failed, usdSpent } = jev.stats;
    console.log(`\nJev: ${requests} requests, ${cached} from cache, ${skipped} skipped (--max-requests), ${failed} failed, $${usdSpent.toFixed(5)} spent.`);
    if (skipped || failed) console.log(`Warning: Jev abstained on ${skipped + failed} events it never saw, so its numbers are incomplete; raise --max-requests or limit --max-events.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
