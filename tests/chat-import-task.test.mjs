import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/index.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "pw-chat-import-task-"));
  const app = await createApp({ dataDir: directory, fetchImpl: async () => { throw new Error("Subscription imports must not call a model"); } });
  app.locals.store.data.papers.push(...["first-paper", "other-paper"].map(id => ({ id, title: id, authors: [], tags: [], source: "web", createdAt: "2026-01-01", abstract: "Bounded source evidence.", text: "Bounded source evidence." })));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  async function api(route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  const exchange = { paperId: "first-paper", question: "What limits this conclusion?", answer: "The evidence has a bounded scope. [Source text]", source: { agent: "Subscription fixture" } };
  return { app, directory, api, exchange };
}

test("imported question task UUID survives both message records, disk reload and fixed-session reads", async t => {
  const { app, directory, api, exchange } = await fixture(t);
  const metadata = { quote: "Bounded source evidence.", sourceScope: "source-text" };
  const first = await api("/chats/new", { paperId: exchange.paperId, metadata });
  const second = await api("/chats/new", { paperId: exchange.paperId });
  const agentTaskId = "A91A7256-D681-4B59-84A8-44D41BA93062";
  const activeBefore = structuredClone(app.locals.store.data.activeConversations);
  const imported = await api("/chats/import", { ...exchange, conversationId: first.data.conversationId, agentTaskId });
  assert.equal(imported.status, 200);
  assert.equal(imported.data.message.agentTaskId, agentTaskId.toLowerCase());
  assert.equal(imported.data.conversationId, first.data.conversationId);
  const messages = (await api(`/chats?paperId=${exchange.paperId}&conversationId=${first.data.conversationId}`)).data.messages;
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(message => message.role), ["user", "assistant"]);
  for (const message of messages) {
    assert.equal(message.agentTaskId, agentTaskId.toLowerCase());
    assert.equal(message.paperId, exchange.paperId);
    assert.equal(message.conversationId, first.data.conversationId);
  }
  assert.deepEqual(messages[0].metadata, metadata);
  assert.equal(messages[1].mode, "agent");
  assert.deepEqual(app.locals.store.data.activeConversations, activeBefore);
  assert.deepEqual((await api(`/chats?paperId=${exchange.paperId}&conversationId=${second.data.conversationId}`)).data.messages, []);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "store.json"), "utf8")).chats, messages);
  const reloaded = await createApp({ dataDir: directory });
  assert.deepEqual(reloaded.locals.store.data.chats, messages);
  // This ID correlates an exchange; it deliberately does not add an idempotency contract.
  assert.equal((await api("/chats/import", { ...exchange, conversationId: first.data.conversationId, agentTaskId })).status, 200);
  assert.equal(app.locals.store.data.chats.length, 4);
});

test("invalid imported task IDs and wrong paper-session bindings are atomic, while legacy imports remain valid", async t => {
  const { app, api, exchange } = await fixture(t);
  const before = structuredClone(app.locals.store.data);
  for (const agentTaskId of [null, "", "not-a-uuid", 1, [], {}, "a91a7256-d681-0b59-84a8-44d41ba93062", "a91a7256-d681-4b59-04a8-44d41ba93062"]) {
    const invalid = await api("/chats/import", { ...exchange, agentTaskId });
    assert.equal(invalid.status, 400);
    assert.match(invalid.data.error, /agentTaskId must be a UUID/);
    assert.deepEqual(app.locals.store.data, before);
  }
  const other = await api("/chats/new", { paperId: "other-paper" });
  const afterOther = structuredClone(app.locals.store.data);
  assert.equal((await api("/chats/import", { ...exchange, conversationId: other.data.conversationId, agentTaskId: "a91a7256-d681-4b59-84a8-44d41ba93062" })).status, 404);
  assert.deepEqual(app.locals.store.data, afterOther);
  const legacy = await api("/chats/import", exchange);
  assert.equal(legacy.status, 200);
  assert.equal(Object.hasOwn(legacy.data.message, "agentTaskId"), false);
  const saved = (await api(`/chats?paperId=${exchange.paperId}&conversationId=${legacy.data.conversationId}`)).data.messages;
  assert.equal(saved.length, 2);
  assert.ok(saved.every(message => !Object.hasOwn(message, "agentTaskId")));
  assert.deepEqual((await api(`/chats?paperId=other-paper&conversationId=${other.data.conversationId}`)).data.messages, []);
});

test("imported task selection metadata trims boundary whitespace while preserving internal source whitespace", async t => {
  const { api, exchange } = await fixture(t);
  const agentTaskId = "B7C725A7-3BB5-49F6-9DAB-B7D817642E11";
  const quote = "\n    code = evidence\n    next =  two\tvalues\n\t";
  const session = await api("/chats/new", { paperId: exchange.paperId });
  const imported = await api("/chats/import", {
    ...exchange,
    conversationId: session.data.conversationId,
    agentTaskId,
    metadata: { quote, sourceScope: "source-text" },
  });
  assert.equal(imported.status, 200);
  const result = await api(`/chats?paperId=${exchange.paperId}&conversationId=${session.data.conversationId}`);
  assert.equal(result.status, 200);
  assert.equal(result.data.messages.length, 2);
  const [user, assistant] = result.data.messages;
  assert.deepEqual([user.role, assistant.role], ["user", "assistant"]);
  assert.deepEqual(user.metadata, {
    quote: "code = evidence\n    next =  two\tvalues",
    sourceScope: "source-text",
  });
  assert.equal(user.metadata.quote, quote.trim());
  assert.notEqual(user.metadata.quote, quote.replace(/\s+/g, " ").trim());
  for (const message of [user, assistant]) {
    assert.equal(message.agentTaskId, agentTaskId.toLowerCase());
    assert.equal(message.paperId, exchange.paperId);
    assert.equal(message.conversationId, session.data.conversationId);
  }
  assert.deepEqual(assistant, imported.data.message);
});
