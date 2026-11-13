"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../server");
const gatewayProtocol = require("../gateway-protocol");

const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const schema = { type: "object", required: ["title"], properties: { title: { type: "string" } } };

test("chat compatibility layer only activates on request", () => {
  assert.equal(gatewayProtocol.active({}), false);
  assert.equal(gatewayProtocol.active({ ATELIER_PROTOCOL: "responses" }), false);
  assert.equal(gatewayProtocol.active({ ATELIER_PROTOCOL: "chat" }), true);
  assert.equal(gatewayProtocol.isResponsesPayload({ input: [{ role: "user", content: "hi" }] }), true);
  assert.equal(gatewayProtocol.isResponsesPayload({ messages: [{ role: "user", content: "hi" }] }), false);
  assert.equal(gatewayProtocol.chatEndpoint("https://example.test/v1/responses"), "https://example.test/v1/chat/completions");
  assert.equal(gatewayProtocol.chatEndpoint("https://example.test/v1/responses/"), "https://example.test/v1/chat/completions");
  assert.equal(gatewayProtocol.chatEndpoint("https://example.test/v1/chat/completions"), "https://example.test/v1/chat/completions");
});

test("chat body carries instructions, images, token limits and the JSON schema", () => {
  const payload = {
    model: "qwen3-vl-plus",
    instructions: "只输出结构化结果。",
    input: [{ role: "user", content: [
      { type: "input_text", text: "分析这张首帧" },
      { type: "input_image", image_url: imageDataUrl, detail: "high" },
    ] }],
    max_output_tokens: 6500,
    text: { format: { type: "json_schema", name: "atelier_agent_case", strict: true, schema } },
  };
  const body = gatewayProtocol.toChatBody(payload, { ATELIER_CHAT_MAX_TOKENS: "4096" });
  assert.equal(body.model, "qwen3-vl-plus");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");
  assert.deepEqual(body.messages[1].content[0], { type: "text", text: "分析这张首帧" });
  assert.deepEqual(body.messages[1].content[1], { type: "image_url", image_url: { url: imageDataUrl } });
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.stream, false);
  assert.equal(body.response_format.type, "json_schema");
  assert.deepEqual(body.response_format.json_schema.schema, schema);
  assert.equal(body.response_format.json_schema.strict, undefined);
});

test("chat body keeps plain text prompts and never exceeds the provider ceiling", () => {
  const body = gatewayProtocol.toChatBody({ model: "qwen-plus", input: [{ role: "user", content: [{ type: "input_text", text: "简单问题" }] }] }, {});
  assert.equal(body.messages[0].content, "简单问题");
  assert.equal(body.max_tokens, gatewayProtocol.DEFAULT_MAX_TOKENS);
  assert.equal(body.response_format, undefined);
  const capped = gatewayProtocol.toChatBody({ model: "m", input: [], max_output_tokens: 24000 }, { ATELIER_CHAT_MAX_TOKENS: "99999" });
  assert.equal(capped.max_tokens, 24000);
  assert.equal(capped.messages.at(-1).role, "user");
});

test("chat answers are normalised into the Responses shape", () => {
  const completed = gatewayProtocol.fromChatResponse({
    id: "chatcmpl-1",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: "{\"title\":\"拉片\"}" } }],
    usage: { prompt_tokens: 10, completion_tokens: 4 },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.incomplete_details, null);
  assert.equal(api.extractOutputText(completed), "{\"title\":\"拉片\"}");
  assert.equal(completed.usage.completion_tokens, 4);

  const truncated = gatewayProtocol.fromChatResponse({ choices: [{ finish_reason: "length", message: { content: "{\"title\":" } }] });
  assert.equal(truncated.status, "incomplete");
  assert.equal(truncated.incomplete_details.reason, "max_output_tokens");
});

test("gateway requests switch endpoint and payload when the chat protocol is enabled", async t => {
  const previous = process.env.ATELIER_PROTOCOL;
  process.env.ATELIER_PROTOCOL = "chat";
  t.after(() => {
    if (previous === undefined) delete process.env.ATELIER_PROTOCOL;
    else process.env.ATELIER_PROTOCOL = previous;
  });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await api.requestGatewayResponse("https://dashscope.test/compatible-mode/v1/responses", {
    model: "qwen3-vl-plus",
    input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
    max_output_tokens: 500,
  }, { fetchImpl, operation: "测试请求", maxAttempts: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://dashscope.test/compatible-mode/v1/chat/completions");
  assert.equal(calls[0].body.messages[0].content, "ping");
  assert.equal(result.data.status, "completed");
  assert.equal(api.extractOutputText(result.data), "{\"ok\":true}");
});
