import assert from "node:assert/strict";
import test from "node:test";
import { rankDirectoryEntries } from "./directory-search.mjs";

const entries = [
  { id: "ada", username: "ada", name: "Ada Lovelace", email: "ada@example.com" },
  { id: "john", username: "jsmith", name: "John Smith", email: "john@example.com" },
  { id: "joan", username: "joan", name: "Joan Smalls", email: "joan@example.com" },
  { id: "engineering", name: "Engineering" },
];

test("ranks exact usernames ahead of broader matches and accepts an @ prefix", () => {
  assert.equal(rankDirectoryEntries(entries, "@ada")[0].id, "ada");
  assert.equal(rankDirectoryEntries(entries, "Áda")[0].id, "ada");
  assert.equal(rankDirectoryEntries(entries, "john")[0].id, "john");
});

test("matches small typos and adjacent transpositions across display-name words", () => {
  assert.equal(rankDirectoryEntries(entries, "jon smth")[0].id, "john");
  assert.equal(rankDirectoryEntries(entries, "enginering")[0].id, "engineering");
});

test("does not return unrelated short-query matches", () => {
  assert.deepEqual(rankDirectoryEntries(entries, "zz"), []);
  assert.deepEqual(rankDirectoryEntries(entries, "ad"), [entries[0]]);
});
