"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const api = require("../server");
const imageDataUrl = `data:image/webp;base64,${fs.readFileSync(path.join(__dirname, "../public/assets/red-device.webp")).toString("base64")}`;
const input = api.normalizeCreativePromptRequest({ brief: "Keep the subject and slowly move the camera", imageDataUrl, duration: 8, aspectRatio: "9:16", targetModel: "Vidu Q4" });
const result = { visualSummary: "Portrait holding a red phone", imagePrompt: "Keep the portrait and red phone", videoPrompt: "Slow camera move while preserving both hands and the red phone.", negativePrompt: "No deformation", motionPlan: [0, 2, 5].map(t => ({ time: `${t}s`, action: "Hold phone", camera: "Slow move" })) };
const response = (status = "completed") => new Response(JSON.stringify({ id: "resp-test", status, output_text: JSON.stringify(result) }));
const networkFailure = () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }); };
const config = tag => ({ baseUrl: `https://gateway-${tag}.test/v1`, apiKey: "private-gpt-key", model: `gpt-6-${tag}`, fallbackModel: `gpt-6-luna-${tag}`,
  backup: { baseUrl: `https://deepseek-${tag}.test`, apiKey: "private-deepseek-key", model: "deepseek-flash", provider: "deepseek", supportsImages: true } });

test("official backup binds the key to the verified vision model and endpoint", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creative-backup-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("creative-backup-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "config.json");
  assert.equal(api.getCreativeBackupConfig({}, file), null);
  fs.writeFileSync(file, JSON.stringify({ apiKey: "local-secret", baseUrl: "https://untrusted.test", model: "text-only" }));
  const backup = api.getCreativeBackupConfig({}, file);
  assert.equal(backup.baseUrl, "https://api.deepseek.com"); assert.equal(backup.model, "deepseek-flash"); assert.equal(backup.supportsImages, true);
  assert.equal(backup.apiKey, "local-secret");
  assert.equal(api.getCreativeBackupConfig({ DEEPSEEK_API_KEY: "env-secret" }, file).apiKey, "env-secret");
  assert.equal(api.getCreativeBackupConfig({ ATELIER_CREATIVE_BACKUP_ENABLED: "0" }, file), null);
  fs.writeFileSync(file, "broken json");
  assert.throws(() => api.getCreativeBackupConfig({}, file), /配置文件无效/);
});

test("connection failure skips same-host GPT retry and preserves images on independent backup", async () => {
  const c = config("network"), calls = [];
  const output = await api.callCreativePromptGateway(input, { config: c, fetchImpl: async (url, init) => {
    const payload = JSON.parse(init.body); calls.push({ url, model: payload.model });
    if (url.startsWith(c.baseUrl)) return networkFailure();
    assert.equal(url, `${c.backup.baseUrl}/responses`); assert.equal(init.headers.Authorization, "Bearer private-deepseek-key");
    assert.equal(init.redirect, "error"); assert.equal(payload.reasoning.effort, "none"); assert.equal(payload.max_output_tokens, 2800);
    assert.equal(payload.input[0].content[1].image_url, imageDataUrl); assert.equal(payload.text.format.type, "json_schema");
    assert.match(payload.input[0].content[0].text, /Keep the subject/); return response();
  } });
  assert.deepEqual(calls.map(c => c.model), [c.model, "deepseek-flash"]);
  assert.equal(output.provider, "deepseek"); assert.equal(output.fallbackUsed, true); assert.equal(output.result.videoPrompt, result.videoPrompt);
  assert.ok(!JSON.stringify(output).includes("private-"));
  const status = api.creativePromptStatus(c, { reachable: false, authenticated: false });
  assert.equal(status.activeModel, "deepseek-flash"); assert.equal(status.gatewayReachable, true); assert.equal(status.gatewayAuthenticated, true);
  assert.equal(status.backupConfigured, true); assert.ok(!JSON.stringify(status).includes("private-"));
  assert.equal(api.creativePromptRoutes(c)[0].provider, "deepseek");
  assert.equal(api.creativePromptRoutes(c, Date.now() + 600001)[0].model, c.model);
});

test("successful GPT does not call or bill backup", async () => {
  const c = config("success"); let calls = 0;
  const output = await api.callCreativePromptGateway(input, { config: c, fetchImpl: async (url, init) => {
    calls++; assert.equal(url, `${c.baseUrl}/responses`); assert.equal(init.headers.Authorization, "Bearer private-gpt-key"); return response();
  } });
  assert.equal(calls, 1); assert.equal(output.model, c.model); assert.equal(output.fallbackUsed, false);
});

test("backup works without a primary key and does not drop multi-image or text-only input", async () => {
  const c = { ...config("backup-only"), apiKey: "" };
  for (const value of [input, { ...input, imageDataUrls: [imageDataUrl, "data:image/png;base64,aW1hZ2U="] }, { ...input, imageDataUrl: null, imageDataUrls: [] }]) {
    const output = await api.callCreativePromptGateway(value, { config: c, fetchImpl: async (_, init) => {
      const payload = JSON.parse(init.body);
      const images = payload.input[0].content.filter(c => c.type === "input_image");
      assert.equal(images.length, new Set([value.imageDataUrl, ...(value.imageDataUrls || [])].filter(Boolean)).size);
      return response();
    } });
    assert.equal(output.model, "deepseek-flash");
  }
});

test("model errors may try the other GPT model, then use DeepSeek", async () => {
  const c = config("models"), models = [];
  const output = await api.callCreativePromptGateway(input, { config: c, fetchImpl: async (_, init) => {
    const model = JSON.parse(init.body).model; models.push(model);
    return model === "deepseek-flash" ? response() : new Response('{"error":{"message":"model not found"}}', { status: 404 });
  } });
  assert.deepEqual(models, [c.model, c.fallbackModel, "deepseek-flash"]); assert.equal(output.model, "deepseek-flash");
});

test("unavailable providers stop after bounded calls and redact reflected credentials", async () => {
  const c = config("all-fail"); let calls = 0;
  await assert.rejects(api.callCreativePromptGateway(input, { config: c, fetchImpl: async url => {
    calls++; if (url.startsWith(c.baseUrl)) return networkFailure();
    return new Response(JSON.stringify({ error: { message: `Rejected ${c.backup.apiKey} ${c.apiKey}` } }), { status: 401 });
  } }), error => error.errorCode === "GATEWAY_HTTP_401" && !error.message.includes("private-") && error.message.includes("[redacted]"));
  assert.equal(calls, 2);
});

test("incomplete/failed backup output is not delivered as a usable prompt", async () => {
  for (const status of ["incomplete", "failed", "in_progress"]) {
    const c = { ...config(`bad-${status}`), apiKey: "" };
    await assert.rejects(api.callCreativePromptGateway(input, { config: c, fetchImpl: async () => response(status) }), e => e.errorCode === "GATEWAY_INCOMPLETE_OUTPUT");
  }
});

test("backup schema compatibility retry keeps the original images", async () => {
  const c = { ...config("schema"), apiKey: "" }; let calls = 0;
  await api.callCreativePromptGateway(input, { config: c, fetchImpl: async (_, init) => {
    calls++; const payload = JSON.parse(init.body);
    assert.equal(payload.input[0].content[1].image_url, imageDataUrl);
    if (calls === 1) return new Response('{"error":{"message":"schema not supported"}}', { status: 422 });
    assert.equal(payload.text, undefined); return response();
  } });
  assert.equal(calls, 2);
});

test("cancellation does not dispatch backup", async () => {
  const c = config("cancel"), controller = new AbortController(); let calls = 0;
  await assert.rejects(api.callCreativePromptGateway(input, { config: c, signal: controller.signal, fetchImpl: async () => {
    calls++; controller.abort(); throw controller.signal.reason;
  } }), e => e.errorCode === "REQUEST_ABORTED");
  assert.equal(calls, 1);
});

test("HTTP creative path falls back without touching any media endpoint", async t => {
  const c = config("http"); let calls = 0;
  const server = api.createServer({ runCreativePrompt: value => api.callCreativePromptGateway(value, { config: c, fetchImpl: async url => {
    calls++; return url.startsWith(c.baseUrl) ? networkFailure() : response();
  } }) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/creative/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const output = await res.json(); assert.equal(res.status, 200); assert.equal(output.model, "deepseek-flash"); assert.equal(calls, 2);
  assert.equal(output.result.videoPrompt, result.videoPrompt); assert.ok(!JSON.stringify(output).includes("private-"));
  const secretFile = await fetch(`${base}/data/creative-backup.json`); assert.equal(secretFile.status, 404);
});
