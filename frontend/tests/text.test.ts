import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanTranscript,
  summarize,
  structuredNote,
  formatTime,
  wordCount,
  exportText,
} from "../src/lib/text.ts";

test("cleanup removes fillers while retaining names, dosages, numbers, and negations", () => {
  assert.equal(
    cleanTranscript(
      "um, i do not take aspirin. uh, Dr. Chen said 5 mg, not 50 mg.",
    ),
    "I do not take aspirin. Dr. Chen said 5 mg, not 50 mg.",
  );
  assert.equal(
    cleanTranscript("the the next step is clear."),
    "The next step is clear.",
  );
});
test("extractive summaries contain only original cleaned sentences", () => {
  const source =
    "The prototype is ready. We need to review it on Friday. The layout looks good.";
  const summary = summarize(source);
  assert.deepEqual(summary.highlights, [
    "The prototype is ready.",
    "The layout looks good.",
  ]);
  assert.deepEqual(summary.actions, ["We need to review it on Friday."]);
  for (const sentence of [...summary.highlights, ...summary.actions])
    assert.ok(source.includes(sentence));
  assert.deepEqual(summarize(""), { highlights: [], actions: [] });
});
test("clinical formatting keeps source content and does not infer a diagnosis", () => {
  const note = structuredNote("Patient reports headache for 2 days.");
  assert.ok(note.includes("Patient reports headache for 2 days."));
  assert.ok(note.includes("Not assigned automatically"));
  assert.ok(!note.includes("migraine"));
});
test("formatting and export handle empty and boundary values", () => {
  assert.equal(formatTime(Infinity), "00:00");
  assert.equal(formatTime(-3), "00:00");
  assert.equal(formatTime(600), "10:00");
  assert.equal(wordCount("  "), 0);
  assert.equal(wordCount("one\n two"), 2);
  assert.ok(exportText("My note", "Um, hello.", "cleaned").includes("Hello."));
  assert.ok(
    exportText("My note", "Hello.", "summary").includes(
      "No explicit action items found.",
    ),
  );
});
