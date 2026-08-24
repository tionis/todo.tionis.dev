import assert from "node:assert/strict";
import test from "node:test";
import {
  composeSharedText,
  consumeLaunchAction,
  isIosDevice,
  isStoredShareFresh,
  SHARE_MAX_AGE_MS,
  storageNotice,
} from "../lib/pwa";

test("consumes the new-list PWA shortcut while preserving other URL state", () => {
  assert.deepEqual(
    consumeLaunchAction("https://todo.example/?action=new&source=launcher#/dashboard"),
    { action: "new", nextUrl: "/?source=launcher#/dashboard" },
  );
});

test("leaves ordinary launches unchanged", () => {
  assert.deepEqual(
    consumeLaunchAction("https://todo.example/#/list/groceries"),
    { action: null, nextUrl: "/#/list/groceries" },
  );
});

test("consumes shared text and URL for the share-target flow", () => {
  assert.deepEqual(
    consumeLaunchAction("https://todo.example/?action=share&title=Recipe&text=Buy+lemons&url=https%3A%2F%2Fexample.com"),
    { action: "share", sharedText: "Recipe\nBuy lemons\nhttps://example.com", nextUrl: "/" },
  );
});

test("preserves distinct share fields without duplicating identical values", () => {
  assert.equal(composeSharedText("Recipe", "Buy lemons", "https://example.com"), "Recipe\nBuy lemons\nhttps://example.com");
  assert.equal(composeSharedText("Buy lemons", "Buy lemons", null), "Buy lemons");
});

test("rejects expired, future, and malformed stored share handoffs", () => {
  const now = Date.parse("2026-08-24T10:00:00.000Z");
  assert.equal(isStoredShareFresh(now - SHARE_MAX_AGE_MS, now), true);
  assert.equal(isStoredShareFresh(now - SHARE_MAX_AGE_MS - 1, now), false);
  assert.equal(isStoredShareFresh(now + 1, now), false);
  assert.equal(isStoredShareFresh("2026-08-24", now), false);
});

test("consumes an opaque POST share handoff without exposing its content", () => {
  assert.deepEqual(
    consumeLaunchAction("https://todo.example/?action=share&shareId=0c9816dd-6866-4781-97be-9f2722697f74"),
    { action: "share", shareId: "0c9816dd-6866-4781-97be-9f2722697f74", nextUrl: "/" },
  );
});

test("recognizes iPadOS devices using desktop-class user agents", () => {
  assert.equal(isIosDevice("Mozilla/5.0 (iPad)", "iPad", 5), true);
  assert.equal(isIosDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 5), true);
  assert.equal(isIosDevice("Mozilla/5.0 (Macintosh)", "MacIntel", 0), false);
});

test("reports persistence denial and escalating storage pressure", () => {
  assert.equal(storageNotice(true, { usage: 10, quota: 100 }), null);
  assert.equal(storageNotice(false, { usage: 10, quota: 100 })?.level, "info");
  assert.equal(storageNotice(true, { usage: 80, quota: 100 })?.level, "warning");
  assert.equal(storageNotice(true, { usage: 95, quota: 100 })?.level, "critical");
});
