import * as oidc from "openid-client";
import { hashToken, randomToken, upsertOidcUser } from "./database.mjs";

let configurationPromise;
const OIDC_TRANSACTION_TTL_MS = 10 * 60_000;
const MAX_PENDING_OIDC_TRANSACTIONS = 10_000;
export const OIDC_BINDING_COOKIE = "smart_todos_oidc_binding";

function oidcConfiguration(config) {
  configurationPromise ||= oidc.discovery(
    config.oidc.issuer,
    config.oidc.clientId,
    config.oidc.clientSecret,
  );
  return configurationPromise;
}

export function normalizeReturnTo(returnTo, appOrigin) {
  if (typeof returnTo !== "string" || !returnTo.startsWith("/")) return "/";
  try {
    const target = new URL(returnTo, appOrigin);
    if (target.origin !== appOrigin.origin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

export function oidcTransactionHash(state, browserBinding) {
  return hashToken(`${state}:${browserBinding}`);
}

export function oidcBindingCookie(config, value, expiresAt) {
  const attributes = [
    `${OIDC_BINDING_COOKIE}=${value}`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (config.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function verifiedIdentityClaims(claims) {
  return {
    ...claims,
    email: claims.email_verified === true ? claims.email : undefined,
  };
}

export function prepareOidcTransactionStorage(database, now = Date.now()) {
  database.prepare("DELETE FROM oidc_states WHERE expires_at <= ?").run(now);
  const pending = database.prepare("SELECT COUNT(*) AS count FROM oidc_states").get().count;
  if (pending >= MAX_PENDING_OIDC_TRANSACTIONS) {
    throw Object.assign(new Error("Too many pending login attempts"), { status: 503 });
  }
}

export async function beginLogin(database, config, returnTo = "/", existingBrowserBinding) {
  const configuration = await oidcConfiguration(config);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const browserBinding = existingBrowserBinding || randomToken();
  const now = Date.now();
  const expiresAt = now + OIDC_TRANSACTION_TTL_MS;
  const safeReturnTo = normalizeReturnTo(returnTo, config.appOrigin);
  prepareOidcTransactionStorage(database, now);
  database.prepare(`
    INSERT INTO oidc_states (state_hash, code_verifier, nonce, return_to, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(oidcTransactionHash(state, browserBinding), codeVerifier, nonce, safeReturnTo, expiresAt);

  const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: new URL("/api/auth/callback", config.publicUrl).href,
    scope: config.oidc.scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  return { authorizationUrl, browserBinding, expiresAt };
}

export async function finishLogin(database, config, callbackUrl, browserBinding) {
  const state = callbackUrl.searchParams.get("state") || "";
  if (!state || !browserBinding) throw new Error("Invalid or expired OIDC state");
  const stateHash = oidcTransactionHash(state, browserBinding);
  const transaction = database.prepare(
    "SELECT * FROM oidc_states WHERE state_hash = ? AND expires_at > ?"
  ).get(stateHash, Date.now());
  if (!transaction) throw new Error("Invalid or expired OIDC state");
  database.prepare("DELETE FROM oidc_states WHERE state_hash = ?").run(stateHash);

  const configuration = await oidcConfiguration(config);
  const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
    pkceCodeVerifier: transaction.code_verifier,
    expectedState: state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("OIDC provider did not return a subject claim");
  let identityClaims = claims;
  if (tokens.access_token) {
    try {
      const userInfo = await oidc.fetchUserInfo(configuration, tokens.access_token, claims.sub);
      identityClaims = { ...claims, ...userInfo, sub: claims.sub };
    } catch (error) {
      console.warn("OIDC UserInfo request failed; using ID token claims", error);
    }
  }
  const user = upsertOidcUser(database, config.oidc.issuer.href, verifiedIdentityClaims(identityClaims));
  if (!user.active) throw Object.assign(new Error("This account has been deprovisioned"), { status: 403 });
  const sessionToken = randomToken();
  const expiresAt = Date.now() + config.sessionDays * 86_400_000;
  database.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(hashToken(sessionToken), user.id, expiresAt);
  return { sessionToken, expiresAt, returnTo: transaction.return_to };
}

export function sessionCookie(config, value, expiresAt) {
  const attributes = [
    `smart_todos_session=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (config.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearSessionCookie(config) {
  return sessionCookie(config, "", 0);
}
