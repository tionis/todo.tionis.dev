function websocketOrigin(url) {
  const websocketUrl = new URL(url);
  websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
  return websocketUrl.origin;
}

// `scriptHashes` are the sha256 digests of the export's inline scripts (see
// scripts/generate-csp-hashes.mjs). Without them, fall back to 'unsafe-inline'.
export function securityHeaders(publicUrl, scriptHashes = []) {
  const origin = new URL(publicUrl);
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self' ${origin.origin} ${websocketOrigin(origin)}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    `script-src 'self' ${scriptHashes.length ? scriptHashes.map((hash) => `'${hash}'`).join(" ") : "'unsafe-inline'"} 'wasm-unsafe-eval'`,
    "script-src-attr 'none'",
    "style-src 'self'",
    "worker-src 'self' blob:",
    ...(origin.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  return {
    "Content-Security-Policy": contentSecurityPolicy,
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(origin.protocol === "https:"
      ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
      : {}),
  };
}

export function applySecurityHeaders(response, publicUrl, scriptHashes = []) {
  for (const [name, value] of Object.entries(securityHeaders(publicUrl, scriptHashes))) {
    response.setHeader(name, value);
  }
}
