import { test } from "node:test";
import assert from "node:assert/strict";
import { fromOpenTdb, idFor, mergeIntoPack, renderPackFile, validate } from "./update-questions.mjs";

const sample = {
  type: "multiple",
  difficulty: "medium",
  category: "Geography",
  question: "What%20is%20the%20capital%20of%20Mongolia%3F",
  correct_answer: "Ulaanbaatar",
  incorrect_answers: ["Astana", "Bishkek", "Tashkent"],
};

test("converts an Open Trivia DB result", () => {
  const q = fromOpenTdb(sample, "22", "2026-10-16");
  assert.equal(q.q, "What is the capital of Mongolia?");
  assert.equal(q.c, "geo");
  assert.equal(q.d, 2);
  assert.deepEqual(q.w, ["Astana", "Bishkek", "Tashkent"]);
  assert.deepEqual(validate(q), []);
});

test("ids are stable and ignore punctuation and case", () => {
  assert.equal(idFor("What is X?"), idFor("what is x"));
  assert.notEqual(idFor("What is X?"), idFor("What is Y?"));
});

test("rejects malformed questions", () => {
  const good = fromOpenTdb(sample, "22", "2026-10-16");
  assert.ok(validate({ ...good, c: "books" }).length);
  assert.ok(validate({ ...good, w: ["Astana", "Astana", "Bishkek"] }).length);
  assert.ok(validate({ ...good, w: ["Ulaanbaatar", "Astana", "Bishkek"] }).length);
  assert.ok(validate({ ...good, d: 5 }).length);
});

test("merge skips duplicates of core and pack questions", () => {
  const core = [{ q: "What is the capital of Australia?" }];
  const a = fromOpenTdb(sample, "22", "2026-10-16");
  const dupCore = { ...a, q: "What is the capital of Australia ?", id: "x" };
  const { pack, accepted, rejected } = mergeIntoPack([], [a, a, dupCore], core);
  assert.equal(accepted.length, 1);
  assert.equal(pack.length, 1);
  assert.equal(rejected.length, 2);
});

test("rendered pack file defines window.TRIVIA_PACKS", async () => {
  const vm = await import("node:vm");
  const sandbox = { window: {} };
  vm.runInNewContext(renderPackFile([fromOpenTdb(sample, "22", "2026-10-16")], "2026-10-16"), sandbox);
  assert.equal(sandbox.window.TRIVIA_PACKS.questions.length, 1);
});
