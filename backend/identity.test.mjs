import assert from "node:assert/strict";
import test from "node:test";
import { userDisplayName } from "../shared/identity.mjs";

test("uses friendly names without exposing email when better identity claims exist", () => {
  assert.equal(userDisplayName({ name: "Ada Lovelace", username: "ada", email: "ada@example.com" }), "Ada Lovelace");
  assert.equal(userDisplayName({ username: "ada", email: "ada@example.com" }), "@ada");
  assert.equal(userDisplayName({ email: "ada@example.com" }), "ada@example.com");
  assert.equal(userDisplayName(null), "User");
});
