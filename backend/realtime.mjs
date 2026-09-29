import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { getUserForSession, hashToken } from "./database.mjs";
import { cookies } from "./http-helpers.mjs";
import { MAX_DOCUMENT_BYTES } from "./documents.mjs";

// WebSocket layer: per-list document sync and presence (/sync) and per-user dashboard
// notifications (/events). Attach it to the HTTP server with `attach`.
export function createRealtime({ config, database, documents, requestUser, requestAddress, listRowById, accessFor, listShape, allowWritesForClient }) {
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_DOCUMENT_BYTES });
  const clientsByList = new Map();
  const eventClientsByUser = new Map();

  function notifyDashboardUsers(userIds) {
    for (const userId of new Set(userIds.filter(Boolean))) {
      for (const client of eventClientsByUser.get(userId) || []) {
        if (!getUserForSession(database, client.sessionToken)) client.close(1008, "Session ended");
        else if (client.readyState === 1) client.send(JSON.stringify({ type: "dashboard-changed" }));
      }
    }
  }

  function notifyAllDashboards() {
    notifyDashboardUsers([...eventClientsByUser.keys()]);
  }

  function presenceName(user) {
    return user?.name || user?.username || user?.email || "Anonymous";
  }

  function broadcastPresence(listId) {
    const clients = [...(clientsByList.get(listId) || [])].filter((client) => client.presence && client.readyState === 1);
    for (const receiver of clients) {
      const peers = {};
      for (const peer of clients) {
        if (peer === receiver || (receiver.user?.id && peer.user?.id === receiver.user.id)) continue;
        const key = peer.user?.id ? hashToken(peer.user.id).slice(0, 16) : peer.connectionId;
        peers[key] = peer.presence;
      }
      receiver.send(JSON.stringify({ type: "presence", peers }));
    }
  }

  function broadcastDocument(listId, bytes) {
    const list = listRowById(listId);
    for (const client of clientsByList.get(listId) || []) {
      const currentUser = getUserForSession(database, client.sessionToken);
      const access = accessFor(list, currentUser);
      if (!access.read) client.close(1008, "List access revoked");
      else if (client.readyState === 1) {
        client.access = access;
        client.send(JSON.stringify({ type: "ready", access: access.write ? "write" : "read" }));
        client.send(JSON.stringify({ type: "metadata", list: listShape(list, currentUser, true) }));
        client.send(bytes);
      }
    }
  }

  // Content edits: send only the changes the merge added (plus the server's heads so
  // each client can tell whether it still has changes to upload). Access is
  // re-checked for every client, but metadata is only resent on access changes.
  function broadcastChange(listId, { delta, heads }) {
    const list = listRowById(listId);
    const header = JSON.stringify({ type: "delta", heads, size: delta.byteLength });
    for (const client of clientsByList.get(listId) || []) {
      const access = accessFor(list, getUserForSession(database, client.sessionToken));
      if (!access.read) client.close(1008, "List access revoked");
      else if (client.readyState === 1) {
        if (access.write !== client.access?.write) client.send(JSON.stringify({ type: "ready", access: access.write ? "write" : "read" }));
        client.access = access;
        client.send(header);
        if (delta.byteLength) client.send(delta);
      }
    }
  }

  function refreshListConnections(listId) {
    void documents.load(listId).then((document) => broadcastDocument(listId, document)).catch((error) => {
      console.error("Failed to refresh list connections", error);
      for (const client of clientsByList.get(listId) || []) client.close(1013, "Please reconnect");
    });
  }

  function handleUpgrade(request, socket, head) {
    try {
      const url = new URL(request.url || "/", config.publicUrl);
      if (!new Set(["/sync", "/events"]).has(url.pathname) || request.headers.origin !== config.appOrigin.origin) return socket.destroy();
      const currentUser = requestUser(request);
      if (url.pathname === "/events") {
        if (!currentUser) return socket.destroy();
        return webSockets.handleUpgrade(request, socket, head, (webSocket) => {
          webSocket.channel = "events";
          webSocket.user = currentUser;
          webSocket.sessionToken = cookies(request).smart_todos_session;
          webSockets.emit("connection", webSocket);
        });
      }
      const listId = url.searchParams.get("listId");
      const list = listId ? listRowById(listId) : null;
      const access = accessFor(list, currentUser);
      if (!list || !access.read) return socket.destroy();
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSocket.channel = "list";
        webSocket.listId = listId;
        webSocket.access = access;
        webSocket.user = currentUser;
        webSocket.sessionToken = cookies(request).smart_todos_session;
        webSocket.address = requestAddress(request);
        webSockets.emit("connection", webSocket);
      });
    } catch {
      socket.destroy();
    }
  }

  webSockets.on("connection", async (webSocket) => {
    if (webSocket.channel === "events") {
      const userId = webSocket.user.id;
      if (!eventClientsByUser.has(userId)) eventClientsByUser.set(userId, new Set());
      eventClientsByUser.get(userId).add(webSocket);
      webSocket.on("close", () => {
        const clients = eventClientsByUser.get(userId);
        clients?.delete(webSocket);
        if (!clients?.size) eventClientsByUser.delete(userId);
      });
      return;
    }
    const { listId, access } = webSocket;
    webSocket.connectionId = crypto.randomUUID();
    webSocket.pendingUpdates = 0;
    if (!clientsByList.has(listId)) clientsByList.set(listId, new Set());
    clientsByList.get(listId).add(webSocket);
    webSocket.on("close", () => {
      const clients = clientsByList.get(listId);
      clients?.delete(webSocket);
      if (!clients?.size) clientsByList.delete(listId);
      else if (webSocket.presence) broadcastPresence(listId);
    });
    webSocket.send(JSON.stringify({ type: "ready", access: access.write ? "write" : "read" }));
    webSocket.send(JSON.stringify({ type: "metadata", list: listShape(listRowById(listId), webSocket.user, true) }));
    try {
      const document = await documents.load(listId);
      if (webSocket.readyState !== 1) return;
      webSocket.send(document);
    } catch (error) {
      console.error("Failed to load list connection", error);
      webSocket.close(1013, "Please reconnect");
      return;
    }

    webSocket.on("message", async (data, isBinary) => {
      if (!isBinary) {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "presence") {
            webSocket.presence = { name: presenceName(webSocket.user) };
            broadcastPresence(listId);
          } else if (message.type === "presence-leave") {
            webSocket.presence = null;
            broadcastPresence(listId);
          }
        } catch {
          webSocket.close(1008, "Invalid realtime message");
        }
        return;
      }
      if (webSocket.pendingUpdates >= 4) {
        webSocket.close(1008, "Too many pending updates");
        return;
      }
      webSocket.pendingUpdates += 1;
      try {
        const currentAccess = accessFor(listRowById(listId), getUserForSession(database, webSocket.sessionToken));
        if (!allowWritesForClient(webSocket.user?.id || webSocket.address)) {
          webSocket.send(JSON.stringify({ type: "error", message: "Too many updates; slow down" }));
          return;
        }
        if (!currentAccess.write) {
          webSocket.send(JSON.stringify({ type: "error", message: "This list is read-only" }));
          return;
        }
        const merged = await documents.mergeChanges(listId, new Uint8Array(data));
        broadcastChange(listId, merged);
      } catch (error) {
        console.error("Rejected Automerge update", error);
        if (error.status === 503) {
          webSocket.close(1013, "Document processor is busy; retry shortly");
          return;
        }
        if (webSocket.readyState === 1) webSocket.send(JSON.stringify({ type: "error", message: "Invalid document update" }));
      } finally {
        webSocket.pendingUpdates -= 1;
      }
    });

  });

  // Drop connections that stop answering pings, and purge expired sessions/logins.
  const heartbeat = setInterval(() => {
    for (const client of webSockets.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30_000);
  heartbeat.unref();
  webSockets.on("connection", (webSocket) => {
    webSocket.isAlive = true;
    webSocket.on("pong", () => { webSocket.isAlive = true; });
  });

  function closeListClients(listId, reason) {
    for (const client of clientsByList.get(listId) || []) client.close(1000, reason);
    clientsByList.delete(listId);
  }

  function attach(server) {
    server.on("upgrade", handleUpgrade);
  }

  function shutdown() {
    clearInterval(heartbeat);
    for (const client of webSockets.clients) client.close(1001, "Server shutting down");
    webSockets.close();
  }

  return { attach, closeListClients, notifyDashboardUsers, notifyAllDashboards, refreshListConnections, broadcastChange, broadcastDocument, shutdown };
}
