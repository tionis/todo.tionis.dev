import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CSP_HASHES_FILE = "csp-script-hashes.json";

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(filename));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(filename);
  }
  return files;
}

// Static export pages carry inline bootstrap scripts. Hashing them lets the
// backend send a Content-Security-Policy without 'unsafe-inline' for scripts.
export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!match[1].trim()) continue;
    hashes.add(`sha256-${createHash("sha256").update(match[1]).digest("base64")}`);
  }
  return hashes;
}

export async function generateCspHashes({ outDir = path.resolve("out") } = {}) {
  const hashes = new Set();
  for (const filename of await htmlFiles(outDir)) {
    for (const hash of inlineScriptHashes(await fs.readFile(filename, "utf8"))) hashes.add(hash);
  }
  const sorted = [...hashes].sort();
  await fs.writeFile(path.join(outDir, CSP_HASHES_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
  return sorted;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const hashes = await generateCspHashes();
  console.log(`Hashed ${hashes.length} inline scripts for the Content-Security-Policy`);
}
