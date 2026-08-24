import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function filesUnder(root, directory = root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, filename));
    else if (entry.isFile()) files.push(path.relative(root, filename));
  }
  return files;
}

export function renderServiceWorker(template, { revision, apiBase = "" }) {
  if (!template.includes("__BUILD_REVISION__") || !template.includes("__API_BASE__")) {
    throw new Error("Service-worker template placeholders are missing");
  }
  return template
    .replaceAll("__BUILD_REVISION__", revision)
    .replace("__API_BASE__", JSON.stringify(apiBase.replace(/\/$/, "")));
}

export async function generateServiceWorker({
  publicDir = path.resolve("public"),
  outDir = path.resolve("out"),
  apiBase = process.env.NEXT_PUBLIC_BACKEND_URL || "",
} = {}) {
  const template = await fs.readFile(path.join(publicDir, "sw.js"), "utf8");
  const filenames = (await filesUnder(outDir))
    .filter((filename) => filename !== "sw.js")
    .sort();
  const hash = createHash("sha256");
  for (const filename of filenames) {
    hash.update(filename);
    hash.update("\0");
    hash.update(await fs.readFile(path.join(outDir, filename)));
    hash.update("\0");
  }
  const revision = hash.digest("hex").slice(0, 16);
  const worker = renderServiceWorker(template, { revision, apiBase });
  await fs.writeFile(path.join(outDir, "sw.js"), worker);
  return revision;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const revision = await generateServiceWorker();
  console.log(`Generated service worker ${revision}`);
}
