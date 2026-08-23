import assert from "node:assert/strict";
import test from "node:test";
import { refreshFullListDetails } from "../shared/list-refresh-policy.mjs";

test("refreshes current full list metadata after mutations", async () => {
  const calls = [];
  const states = [
    { metadata: { slug: "groceries", _full: true } },
    { metadata: { slug: "dashboard-only" } },
    { metadata: { _full: true } },
  ];

  await refreshFullListDetails(states, async (...args) => calls.push(args));

  assert.deepEqual(calls, [["groceries", true]]);
});
