import assert from "node:assert/strict";
import test from "node:test";
import { consumeLaunchAction } from "../lib/pwa";

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
