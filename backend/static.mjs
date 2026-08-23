import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".wasm", "application/wasm"],
]);

function pathInside(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const candidate = path.resolve(root, `.${decoded}`);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

async function regularFile(filename) {
  try {
    const stats = await fsPromises.stat(filename);
    if (stats.isDirectory()) return regularFile(path.join(filename, "index.html"));
    return stats.isFile() ? { filename, stats } : null;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function cacheControl(filename) {
  const normalized = filename.split(path.sep).join("/");
  if (filename.endsWith(".html") || filename.endsWith("/sw.js")) return "no-cache";
  if (normalized.includes("/_next/static/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

export async function serveStatic(request, response, url, staticDir) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const root = path.resolve(staticDir);
  const requested = pathInside(root, url.pathname);
  if (!requested) return false;

  let file = await regularFile(requested);
  const acceptsHtml = (request.headers.accept || "").includes("text/html");
  if (!file && acceptsHtml && !path.extname(url.pathname)) {
    file = await regularFile(path.join(root, "index.html"));
  }
  if (!file) return false;

  const etag = `W/\"${file.stats.size.toString(16)}-${Math.trunc(file.stats.mtimeMs).toString(16)}\"`;
  const headers = {
    "Cache-Control": cacheControl(file.filename),
    "Content-Length": file.stats.size,
    "Content-Type": CONTENT_TYPES.get(path.extname(file.filename).toLowerCase()) || "application/octet-stream",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }

  response.writeHead(200, headers);
  if (request.method === "HEAD") response.end();
  else fs.createReadStream(file.filename).pipe(response);
  return true;
}
