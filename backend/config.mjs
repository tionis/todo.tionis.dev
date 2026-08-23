import path from "node:path";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function url(value, name) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}

export function loadConfig() {
  const appOrigin = url(process.env.APP_ORIGIN || "http://localhost:3000", "APP_ORIGIN");
  const publicUrl = url(process.env.PUBLIC_URL || "http://localhost:3030", "PUBLIC_URL");

  return {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3030),
    appOrigin,
    publicUrl,
    dataDir: path.resolve(process.env.DATA_DIR || "./data"),
    oidc: {
      issuer: url(required("OIDC_ISSUER"), "OIDC_ISSUER"),
      clientId: required("OIDC_CLIENT_ID"),
      clientSecret: process.env.OIDC_CLIENT_SECRET || undefined,
      scope: process.env.OIDC_SCOPE || "openid email profile",
    },
    sessionDays: Number(process.env.SESSION_DAYS || 30),
    secureCookies: process.env.SECURE_COOKIES
      ? process.env.SECURE_COOKIES === "true"
      : publicUrl.protocol === "https:",
  };
}
