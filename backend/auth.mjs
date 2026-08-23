import * as oidc from "openid-client";
import { hashToken, randomToken, upsertOidcUser } from "./database.mjs";

let configurationPromise;

function oidcConfiguration(config) {
  configurationPromise ||= oidc.discovery(
    config.oidc.issuer,
    config.oidc.clientId,
    config.oidc.clientSecret,
  );
  return configurationPromise;
}

export async function beginLogin(database, config, returnTo = "/") {
  const configuration = await oidcConfiguration(config);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  database.prepare(`
    INSERT INTO oidc_states (state_hash, code_verifier, nonce, return_to, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(hashToken(state), codeVerifier, nonce, safeReturnTo, Date.now() + 10 * 60_000);

  return oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: new URL("/api/auth/callback", config.publicUrl).href,
    scope: config.oidc.scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
}

export async function finishLogin(database, config, callbackUrl) {
  const state = callbackUrl.searchParams.get("state") || "";
  const transaction = database.prepare(
    "SELECT * FROM oidc_states WHERE state_hash = ? AND expires_at > ?"
  ).get(hashToken(state), Date.now());
  if (!transaction) throw new Error("Invalid or expired OIDC state");
  database.prepare("DELETE FROM oidc_states WHERE state_hash = ?").run(hashToken(state));

  const configuration = await oidcConfiguration(config);
  const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
    pkceCodeVerifier: transaction.code_verifier,
    expectedState: state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("OIDC provider did not return a subject claim");
  const user = upsertOidcUser(database, config.oidc.issuer.href, claims);
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
