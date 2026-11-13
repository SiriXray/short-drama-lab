"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getCreativePromptConfig, normalizeCreativePromptRequest, callCreativePromptGateway, createServer } = require("../server");
const imageDataUrl = `data:image/webp;base64,${fs.readFileSync(path.join(__dirname, "../public/assets/red-device.webp")).toString("base64")}`;
const input = normalizeCreativePromptRequest({ brief: "Keep the product structure, move the camera slowly", imageDataUrl, duration: 8, aspectRatio: "9:16", targetModel: "Vidu Q4" });
const config = (model = "gpt-6-sol", fallbackModel = "") => ({ baseUrl: "https://test.example/v1", apiKey: "test-private", model, fallbackModel });
const result = { title: "Product reveal", imagePrompt: "Product on a clean background", videoPrompt: "Slow camera move around the product; preserve its shape and color.", negativePrompt: "No deformation", motionPlan: [0, 2, 5].map(t => ({ time: `${t}s`, action: "Hold product", camera: "Slow move" })) };
const response = (status = "completed") => new Response(JSON.stringify({ id: "resp-test", status, output_text: JSON.stringify(result) }), { headers: { "x-request-id": "request-test" } });

test("creative routing moves to GPT-6 without altering other workflows or credentials", () => {
  const base = { ...config("gpt-5.6-sol", "gpt-5.6-terra"), reasoningEffort: "high" };
  const creative = getCreativePromptConfig(base, {}, null);
  assert.equal(creative.model, "gpt-6-sol"); assert.equal(creative.fallbackModel, "gpt-6-luna");
  assert.equal(base.model, "gpt-5.6-sol"); assert.equal(creative.baseUrl, base.baseUrl); assert.equal(creative.apiKey, base.apiKey);
  const custom = getCreativePromptConfig(base, { ATELIER_CREATIVE_MODEL: "gpt-6-astra", ATELIER_CREATIVE_FALLBACK_MODEL: "" }, null);
  assert.equal(custom.model, "gpt-6-astra"); assert.equal(custom.fallbackModel, "");
});
test("GPT-6 image-to-motion preserves image inputs, Responses schema and frontend result contract", async () => {
  const output = await callCreativePromptGateway(input, { config: config(), fetchImpl: async (url, init) => {
    assert.equal(url, "https://test.example/v1/responses"); assert.equal(init.headers.Authorization, "Bearer test-private");
    const payload = JSON.parse(init.body);
    assert.equal(payload.model, "gpt-6-sol"); assert.equal(payload.text.format.type, "json_schema"); assert.equal(payload.reasoning.effort, "low");
    assert.equal(payload.input[0].content[1].image_url, imageDataUrl);
    assert.match(payload.input[0].content[0].text, /Vidu Q4/);
    return response();
  } });
  assert.equal(output.model, "gpt-6-sol"); assert.equal(output.fallbackUsed, false); assert.equal(output.result.videoPrompt, result.videoPrompt); assert.equal(output.result.motionPlan.length, 3);
  assert.ok(!JSON.stringify(output).includes("test-private"));
});
test("schema incompatibility retries plain JSON on the same configured model", async () => {
  const payloads = [];
  const output = await callCreativePromptGateway(input, { config: config("gpt-6-schema-fixture"), fetchImpl: async (_url, init) => {
    payloads.push(JSON.parse(init.body)); return payloads.length === 1 ? new Response('{"error":{"message":"json_schema not supported"}}', { status: 400 }) : response();
  } });
  assert.equal(payloads.length, 2); assert.equal(payloads[1].model, payloads[0].model); assert.equal(payloads[1].text, undefined); assert.equal(output.result.videoPrompt, result.videoPrompt);
});
test("incomplete output cannot become a ready-to-generate prompt", async () => {
  await assert.rejects(callCreativePromptGateway(input, { config: config("gpt-6-incomplete-fixture"), fetchImpl: async () => response("incomplete") }), e => e.errorCode === "GATEWAY_INCOMPLETE_OUTPUT");
});
test("explicit cancellation does not start a fallback request", async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(callCreativePromptGateway(input, { config: config("gpt-6-cancel-fixture", "gpt-6-luna"), signal: controller.signal, fetchImpl: async () => {
    calls++; controller.abort(new Error("cancel test")); throw controller.signal.reason;
  } }), e => e.errorCode === "REQUEST_ABORTED");
  assert.equal(calls, 1);
});
test("creative HTTP endpoint returns GPT-6 motion prompts without submitting media", async t => {
  let calls = 0;
  const server = createServer({ runCreativePrompt: value => callCreativePromptGateway(value, { config: config(), fetchImpl: async () => { calls++; return response(); } }) });
  await new Promise(r => server.listen(0, "127.0.0.1", r)); t.after(() => new Promise(r => server.close(r)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/creative/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(res.status, 200); const data = await res.json();
  assert.equal(data.model, "gpt-6-sol"); assert.equal(data.result.videoPrompt, result.videoPrompt); assert.ok(data.generatedAt); assert.equal(calls, 1);
});
test("network failure falls back to GPT-6 Luna and never the old GPT-5.6 route", async () => {
  const models = [];
  const output = await callCreativePromptGateway(input, { config: getCreativePromptConfig(config(), {}, null), fetchImpl: async (_url, init) => {
    models.push(JSON.parse(init.body).model);
    if (models.length === 1) throw Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    return response();
  } });
  assert.deepEqual(models, ["gpt-6-sol", "gpt-6-luna"]); assert.equal(output.fallbackUsed, true); assert.equal(output.model, "gpt-6-luna");
});
