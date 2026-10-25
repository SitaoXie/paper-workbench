import test from "node:test";
import assert from "node:assert/strict";
import { prepareConversationHistory } from "../server/conversation-context.mjs";
import { answerQuestion } from "../server/models.mjs";
import { defaultSettings } from "../server/storage.mjs";

test("short histories retain complete user/assistant pairs without a spurious truncation notice", () => {
  const history = [{ role: "user", content: "Question one" }, { role: "assistant", content: "Answer one" }, { role: "user", content: "Question two" }, { role: "assistant", content: "Answer two" }];
  const result = prepareConversationHistory(history, 8000);
  assert.deepEqual(result.messages, history);
  assert.equal(result.notice, ""); assert.equal(result.omittedMessages, 0); assert.equal(result.truncatedMessages, 0);
  assert.equal(result.characters, history.reduce((sum, message) => sum + message.content.length, 0));
});

test("the newest pair shares the bounded allowance and retains both question and answer with explicit omissions", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `TURN-${index}-START ` + "x".repeat(10000) + ` TURN-${index}-END` }));
  const result = prepareConversationHistory(history, 8000);
  assert.equal(result.budget, 4000); assert.ok(result.characters <= 4000);
  assert.deepEqual(result.messages.map(message => message.role), ["user", "assistant"]);
  assert.match(result.messages[0].content, /TURN-28-START/); assert.match(result.messages[0].content, /TURN-28-END/);
  assert.match(result.messages[1].content, /TURN-29-START/); assert.match(result.messages[1].content, /TURN-29-END/);
  assert.ok(result.messages.every(message => message.content.includes("middle omitted")));
  assert.equal(result.omittedMessages, 28); assert.equal(result.truncatedMessages, 2);
  assert.equal(result.incomplete, false); assert.match(result.notice, /do not reconstruct/);
});

test("arbitrarily long history remains capped, and orphaned assistant replies are clearly marked", () => {
  const history = Array.from({ length: 10000 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `${index}: ` + "A".repeat(30000) }));
  const result = prepareConversationHistory(history, 300000);
  assert.equal(result.budget, 24000); assert.ok(result.characters <= 24000);
  assert.ok(result.messages.length <= 12); assert.ok(result.messages.every(message => message.content.length <= 8000));
  assert.equal(result.omittedMessages, history.length - result.messages.length);
  const orphan = prepareConversationHistory([{ role: "assistant", content: "A reply without the original question." }], 8000);
  assert.equal(orphan.incomplete, true); assert.match(orphan.notice, /no paired user message/);
});

test("empty history produces neither injected turns nor a false incomplete-history warning", () => {
  const result = prepareConversationHistory([], 44000);
  assert.deepEqual(result.messages, []); assert.equal(result.characters, 0); assert.equal(result.budget, 22000);
  assert.equal(result.notice, ""); assert.equal(result.incomplete, false);
});

test("question payload bounds history independently while preserving the full current question and selected source", async () => {
  const paper = { id: "payload-fixture", title: "Source budget", authors: [], abstract: "", pages: Array.from({ length: 44 }, (_, index) => ({ number: index + 1, text: "Original evidence. ".repeat(700) })) };
  const question = "Q".repeat(12000);
  const metadata = { page: 42, quote: "S".repeat(12000) };
  const history = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "H".repeat(8000) }));
  let body;
  const answer = await answerQuestion([paper], question, history, { ...defaultSettings, apiKey: "fixture", contextChars: 8000 }, { metadata, fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "A cautious response. [p.42]" } }] }));
  } });
  assert.ok(body.messages.at(-1).content.startsWith(question));
  assert.ok(body.messages.at(-1).content.includes(JSON.stringify(metadata)));
  assert.ok(body.messages.slice(1, -1).filter(message=>message.role!=="system").reduce((sum, message) => sum + message.content.length, 0) <= 4000);
  assert.match(body.messages.filter(message=>message.role==="system").map(message=>message.content).join("\n"), /Conversation history is incomplete/);
  assert.ok(!body.messages[0].content.includes("Conversation history is incomplete"), "dynamic history notices follow the stable source prefix");
  const context = answer.source.inputContext;
  assert.ok(context.sourceCharacters <= 8000); assert.equal(context.historyBudgetCharacters, 4000);
  assert.equal(context.currentQuestionCharacters, body.messages.at(-1).content.length);
  assert.equal(context.totalMessageCharacters, body.messages.reduce((sum, message) => sum + message.content.length, 0));
  assert.ok(context.totalMessageCharacters < 42000); assert.equal(context.incompleteHistory, true);
  assert.ok(Object.values(context).every(value => ["number", "boolean"].includes(typeof value)), "Public statistics must not reveal prompt or source strings");
});

test("historical visual answers are withdrawn by provenance while valid observations remain explicitly unverified", () => {
  const original = [
    { role: "user", content: "Old question" },
    { role: "assistant", content: "WITHDRAWN_CLAIM", source: { visualEvidenceIds: ["old-observation"] } },
    { role: "user", content: "Current question" },
    { role: "assistant", content: "CURRENT_UNVERIFIED_CLAIM", source: { visualEvidenceIds: ["current-observation"] } },
  ];
  const snapshot = structuredClone(original);
  const result = prepareConversationHistory(original, 8000, { currentVisualEvidenceIds: new Set(["current-observation"]) });
  assert.ok(!result.messages.some(message => message.content.includes("WITHDRAWN_CLAIM")));
  assert.match(result.messages[1].content, /excluded, stale, superseded or unavailable/);
  assert.match(result.messages[3].content, /Unverified historical model output/);
  assert.match(result.messages[3].content, /CURRENT_UNVERIFIED_CLAIM/);
  assert.deepEqual(result.visualEvidenceIds, ["current-observation"]);
  assert.equal(result.withdrawnVisualMessages, 1);
  assert.deepEqual(original, snapshot, "Historical records must remain intact for the reader");
});

test("malformed historical provenance cannot label content as valid visual evidence, while untagged legacy answers stay untrusted text", () => {
  for (const visualEvidenceIds of ["current", ["https://untrusted.example"], ["x".repeat(129)], Array(33).fill("current"), [null]]) {
    const result = prepareConversationHistory([{ role: "assistant", content: "MALFORMED_PROVENANCE_CLAIM", source: { visualEvidenceIds } }], 8000, { currentVisualEvidenceIds: new Set(["current"]) });
    assert.ok(!result.messages[0].content.includes("MALFORMED_PROVENANCE_CLAIM"));
    assert.match(result.messages[0].content, /provenance is invalid/);
    assert.deepEqual(result.visualEvidenceIds, []);
  }
  const legacy = prepareConversationHistory([{ role: "assistant", content: "A legacy answer without source IDs." }], 8000);
  assert.match(legacy.messages[0].content, /legacy answer/);
  assert.deepEqual(legacy.visualEvidenceIds, []);
});

test("later questions cannot reintroduce excluded, superseded or stale visual conclusions through stored assistant history", async () => {
  const crop = { x: .1, y: .1, width: .5, height: .5 };
  const observation = { id: "old-observation", figureId: "chart", page: 1, crop, markdown: "Old chart interpretation.", pixelsProvided: true, analysisMethod: "vision-model" };
  for (const state of ["excluded", "superseded", "stale", "current"]) {
    const paper = { id: "visual-history", title: "Visual evidence", authors: [], abstract: "", filePath: "fixture.pdf", pages: [{ number: 1, text: "The original source describes uncertainty." }], figures: [{ id: "chart", page: 1, crop }], visualEvidence: [{ ...observation }] };
    if (state === "excluded") paper.visualEvidence[0].excluded = true;
    if (state === "superseded") paper.visualEvidence.push({ ...observation, id: "new-observation", markdown: "Updated interpretation." });
    if (state === "stale") paper.figures[0].crop = { ...crop, x: .2 };
    let messages;
    const history = [{ role: "user", content: "Inspect the chart" }, { role: "assistant", content: "HISTORICAL_VISUAL_CLAIM", source: { visualEvidenceIds: [observation.id] } }];
    const reply = await answerQuestion([paper], "What follows?", history, { ...defaultSettings, apiKey: "fixture-key" }, { fetchImpl: async (_url, options) => {
      messages = JSON.parse(options.body).messages;
      return new Response(JSON.stringify({ choices: [{ message: { content: "A cautious answer. [p.1]" } }] }));
    } });
    assert.equal(messages.some(message => message.content.includes("HISTORICAL_VISUAL_CLAIM")), state === "current");
    assert.equal(reply.source.visualEvidenceIds.includes("old-observation"), state === "current");
    assert.equal(reply.source.inputContext.withdrawnVisualHistoryMessages, state === "current" ? 0 : 1);
    assert.equal(reply.source.pixelsProvided, false);
    assert.equal(history[1].content, "HISTORICAL_VISUAL_CLAIM");
  }
});
