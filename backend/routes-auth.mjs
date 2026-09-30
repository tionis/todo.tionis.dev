import { NOT_HANDLED } from "./route-result.mjs";
import { beginLogin, clearSessionCookie, finishLogin, OIDC_BINDING_COOKIE, oidcBindingCookie, sessionCookie } from "./auth.mjs";
import { cookies, fail, json, readJson } from "./http-helpers.mjs";
import { hashToken } from "./database.mjs";

// Health check and OIDC login/session routes.
// A handler answers the request and returns, or returns NOT_HANDLED so the next group can try.
export function createRoutesAuth(ctx) {
  const { config, database, requestUser, requestAddress, trustedMutation, userShape, allowLoginForClient, allowLoginGlobally } = ctx;

  return async function handle(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { status: "ok" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/login") {
      if (!allowLoginForClient(requestAddress(request)) || !allowLoginGlobally("global")) {
        response.setHeader("Retry-After", "600");
        return fail(response, 429, "Too many login attempts; try again later");
      }
      const login = await beginLogin(
        database,
        config,
        url.searchParams.get("returnTo") || "/",
        cookies(request)[OIDC_BINDING_COOKIE],
      );
      response.writeHead(302, {
        Location: login.authorizationUrl.href,
        "Set-Cookie": oidcBindingCookie(config, login.browserBinding, login.expiresAt),
      });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/callback") {
      const session = await finishLogin(database, config, url, cookies(request)[OIDC_BINDING_COOKIE]);
      // Rotate: a session that was valid before this login must not outlive it.
      const previous = cookies(request).smart_todos_session;
      if (previous) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(previous));
      response.writeHead(302, {
        Location: new URL(session.returnTo, config.appOrigin).href,
        "Set-Cookie": sessionCookie(config, session.sessionToken, session.expiresAt),
      });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/session") {
      json(response, 200, { user: userShape(requestUser(request)) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      if (!trustedMutation(request, response)) return;
      const token = cookies(request).smart_todos_session;
      const body = await readJson(request, 1_000);
      const user = requestUser(request);
      if (body.all === true && user) database.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      else if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
      response.setHeader("Set-Cookie", clearSessionCookie(config));
      json(response, 200, { ok: true });
      return;
    }

    return NOT_HANDLED;
  };
}
