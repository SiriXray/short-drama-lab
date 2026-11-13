"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { buildVideoRequest, normalizeTask, createVideoClient, MODELS } = require("../drama-video-models");
const { createDramaRouter } = require("../drama-router");
const { createSettings } = require("../drama-settings");
const input = (extra = {}) => ({ provider: "wan", mode: "r2v", prompt: "Two characters talking", duration: 16, resolution: "1080P", ratio: "9:16", images: ["https://cdn.example/lead.jpg"], ...extra });
const tmp = t => { const r = fs.mkdtempSync(path.join(os.tmpdir(), "drama-model-test-")); t.after(() => fs.rmSync(r, { force: true, recursive: true })); return r; };
const deps = extra => ({ getGatewayConfig: () => ({ baseUrl: "https://text.example", model: "test" }), getViduConfig: () => ({ baseUrl: "https://vidu.example" }), ...extra });
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

test("Wan 3 uses media roles, ratio is omitted only for I2V, references are numbered", () => {
  const first = "https://cdn.example/a.jpg", last = "https://cdn.example/b.jpg";
  const r = buildVideoRequest(input({ mode: "i2v", images: [first, last] }));
  assert.equal(r.endpoint, "/services/aigc/video-generation/video-synthesis");
  assert.equal(r.payload.model, "wan3.0-video");
  assert.deepEqual(r.payload.input.media, [{ type: "first_frame", url: first }, { type: "last_frame", url: last }]);
  assert.equal(r.payload.parameters.ratio, undefined);
  assert.equal(r.payload.input.img_url, undefined);
  const ref = buildVideoRequest(input({ images: [first, last] })).payload;
  assert.match(ref.input.prompt, /\[Image 1\].*\[Image 2\]/);
  assert.ok(ref.input.media.every(m => m.type === "reference_image"));
  assert.equal(ref.parameters.ratio, "9:16");
  const txt = buildVideoRequest(input({ mode: "t2v", images: [], duration: 30 })).payload;
  assert.equal(txt.input.media, undefined); assert.equal(txt.parameters.duration, 30);
});

test("H3 uses v2 content schema, strict 4-15 second duration and 2K", () => {
  const base = input({ provider: "minimax", duration: 15, resolution: "2K" });
  const r = buildVideoRequest(base);
  assert.equal(r.endpoint, "/v2/video_generation"); assert.equal(r.payload.model, "MiniMax-H3");
  assert.deepEqual(r.payload.content[1], { type: "image_url", image_url: { url: base.images[0] }, role: "reference_image" });
  const image = buildVideoRequest({ ...base, mode: "i2v" }).payload;
  assert.equal(image.content[1].role, "first_frame"); assert.equal(image.ratio, undefined);
  assert.equal(buildVideoRequest({ ...base, mode: "t2v", images: [] }).payload.ratio, "9:16");
  for (const duration of [3, 16, 4.5, "5"]) assert.throws(() => buildVideoRequest({ ...base, duration }), /时长/);
  for (const duration of [4, 15]) assert.equal(buildVideoRequest({ ...base, duration }).payload.duration, duration);
});

test("validation rejects incompatible images, modes and local files before any request", () => {
  for (const images of [[], Array(11).fill("https://cdn.example/a.png")]) assert.throws(() => buildVideoRequest(input({ images })));
  assert.throws(() => buildVideoRequest(input({ mode: "i2v", images: Array(3).fill("https://cdn.example/a.png") })));
  assert.throws(() => buildVideoRequest(input({ provider: "minimax", duration: 15, resolution: "2K", images: Array(10).fill("https://cdn.example/a.png") })));
  for (const url of ["/image.png", "data:image/png;base64,aaaa", "http://127.0.0.1:4331/image.png", "http://localhost/x", "http://192.168.1.2/x", "https://user:secret@cdn.example/x"]) assert.throws(() => buildVideoRequest(input({ images: [url] })));
  for (const extra of [{ provider: "other" }, { provider: "__proto__" }, { duration: 31 }, { resolution: "2K" }, { ratio: "bad" }, { prompt: "" }, { mode: "t2v" }]) assert.throws(() => buildVideoRequest(input(extra)));
});

test("provider states and URLs normalize without swapping task ownership", () => {
  assert.deepEqual(normalizeTask("wan", { output: { task_id: "w", task_status: "SUCCEEDED", video_url: "https://cdn.example/w.mp4" } }).creations, [{ url: "https://cdn.example/w.mp4" }]);
  for (const status of ["FAILED", "CANCELED"]) assert.equal(normalizeTask("wan", { output: { task_status: status } }, "w").state, "failed");
  assert.equal(normalizeTask("wan", { output: { task_status: "UNKNOWN" } }, "w").state, "unknown");
  for (const status of ["failed", "cancelled", "expired"]) assert.equal(normalizeTask("minimax", { task: { status } }, "m").state, "failed");
  assert.equal(normalizeTask("minimax", { task: { status: "succeeded", content: { url: "https://cdn.example/m.mp4" } } }, "m").creations[0].url, "https://cdn.example/m.mp4");
});

test("clients submit with Bearer and async header; polling uses provider-specific routes", async () => {
  const calls = [];
  const c = createVideoClient(k => ({ baseUrl: MODELS[k].baseUrl, apiKey: "private-key" }), async (url, init) => {
    calls.push({ url, init }); return response(url.includes("minimaxi") ? (init.method === "POST" ? { task_id: "m" } : { task: { status: "succeeded", content: { url: "https://cdn.example/m.mp4" } } }) : { output: { task_id: "w", task_status: "RUNNING" } });
  });
  for (const provider of ["wan", "minimax"]) {
    const r = buildVideoRequest(input({ provider, duration: 5, resolution: MODELS[provider].resolutions[0] }));
    const task = await c.submit(provider, r.endpoint, r.payload);
    await c.poll(provider, task.taskId);
  }
  assert.ok(calls.every(c => c.init.headers.Authorization === "Bearer private-key" && c.init.redirect === "error"));
  assert.equal(calls[0].init.headers["X-DashScope-Async"], "enable");
  assert.equal(calls[2].init.headers["X-DashScope-Async"], undefined);
  assert.match(calls[1].url, /\/api\/v1\/tasks\/w$/);
  assert.match(calls[3].url, /\/v2\/query\/video_generation\/m$/);
  assert.throws(() => c.poll("wan", "../m"));
  await assert.rejects(c.poll("wan", "w", "https://other.example"), /绑定/);
  assert.equal(calls.length, 4);
});

test("upstream errors are sanitized and ambiguous network/JSON errors never become safe retries", async () => {
  for (const data of [{ error: { message: "private-key" } }, { base_resp: { status_code: 1001, status_msg: "private-key" } }]) {
    const c = createVideoClient(() => ({ baseUrl: "https://api.example", apiKey: "private-key" }), async () => response(data));
    await assert.rejects(c.submit("minimax", "/v2/video_generation", {}), e => e.statusCode === 422 && !e.message.includes("private-key"));
  }
  const c = createVideoClient(() => ({ baseUrl: "https://api.example", apiKey: "private-key" }), async () => { throw new Error("private-key"); });
  await assert.rejects(c.submit("wan", "/submit", {}), e => e.statusCode === 502 && !e.message.includes("private-key"));
});

async function harness(t, mockFetch) {
  const root = tmp(t);
  const s = createSettings(root, deps());
  s.update({ services: { wan: { apiKey: "secret-wan" }, minimax: { apiKey: "secret-minimax" } } });
  const router = createDramaRouter(deps({ settingsFetch: mockFetch, pollIntervalMs: 0, pollTimeoutMs: 25,
    remoteContent: async (_url, _private, o) => fs.writeFileSync(o.destination, "fixture"),
    probe: async () => ({ videoCodec: "h264", width: 1080, height: 1920, duration: 16 }) }), { root });
  const p = { id: randomUUID(), title: "Model QA", rightsConfirmed: true, aspectRatio: "9:16", assets: [], episodes: [], deliveries: [{ id: "old", file: "delivery.mp4" }], ledger: [], events: [], production: { referenceModel: "viduq4-preview", generationSeconds: 16 } };
  router.store.save(p);
  const server = http.createServer((req, res) => router.route(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/drama`;
  const post = (route, body) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { root, router, p, base, post, run: async body => {
    const response = await post(`/projects/${p.id}/trials`, body);
    await router.engine.active.get(p.id); return response;
  } };
}

test("HTTP trials require confirmation, persist provider, dedupe submission, save gallery and preserve Q4", async t => {
  let submissions = 0;
  const h = await harness(t, async (_url, init) => { if (init.method === "POST") submissions++; return response({ output: { task_id: "paid-wan", task_status: "SUCCEEDED", video_url: "https://cdn.example/movie.mp4" } }); });
  const body = { ...input(), id: randomUUID(), confirmPaid: true };
  assert.equal((await h.run({ ...body, confirmPaid: false })).status, 400);
  assert.equal((await h.run({ ...body, provider: "minimax", resolution: "2K" })).status, 400);
  assert.equal(submissions, 0);
  assert.equal((await h.run(body)).status, 202);
  assert.equal(h.p.job.status, "completed", h.p.job.error);
  assert.equal((await h.run(body)).status, 200); assert.equal(submissions, 1);
  const record = h.p.modelTrials[0].video;
  assert.equal(record.provider, "wan"); assert.equal(record.baseUrl, MODELS.wan.baseUrl);
  assert.equal(record.taskId, "paid-wan"); assert.ok(record.file);
  assert.equal(h.p.production.referenceModel, "viduq4-preview"); assert.equal(h.p.deliveries[0].file, "delivery.mp4");
  const library = await (await fetch(h.base + "/library")).json();
  assert.ok(library.items.some(i => i.trialId === body.id));
  const workspace = await (await fetch(h.base + "/workspace")).json();
  assert.equal(workspace.modelTrials.length, 1); assert.equal(workspace.tasks[0].saved, true);
  assert.doesNotMatch(JSON.stringify(workspace), /secret-wan|secret-minimax/);
  await h.post(`/projects/${h.p.id}/trials/${body.id}/resume`, {}); await h.router.engine.active.get(h.p.id);
  assert.equal(submissions, 1);
});

test("unknown submit blocks duplicates; task ID reconciliation queries the original provider", async t => {
  let submissions = 0, polls = 0;
  const h = await harness(t, async (_url, init) => {
    if (init.method === "POST") { submissions++; throw new Error("timeout"); }
    polls++; return response({ task: { status: "succeeded", content: { url: "https://cdn.example/recovered.mp4" } } });
  });
  const body = { ...input({ provider: "minimax", duration: 15, resolution: "2K" }), id: randomUUID(), confirmPaid: true };
  await h.run(body); assert.equal(h.p.modelTrials[0].video.state, "unknown");
  assert.equal((await h.run({ ...body, id: randomUUID() })).status, 409);
  assert.equal((await h.post(`/projects/${h.p.id}/trials/${body.id}/resume`, {})).status, 409);
  assert.equal((await h.post(`/projects/${h.p.id}/trials/${body.id}/task`, { taskId: "paid-h3" })).status, 202);
  await h.post(`/projects/${h.p.id}/trials/${body.id}/resume`, {}); await h.router.engine.active.get(h.p.id);
  assert.equal(h.p.job.status, "completed", h.p.job.error); assert.equal(submissions, 1); assert.equal(polls, 2);
});

test("pending tasks resume by ID after waiting deadline without a second paid call", async t => {
  let submissions = 0, done = false;
  const h = await harness(t, async (_url, init) => { if (init.method === "POST") submissions++; return response({ output: { task_id: "slow-wan", task_status: done ? "SUCCEEDED" : "RUNNING", ...(done ? { video_url: "https://cdn.example/done.mp4" } : {}) } }); });
  const body = { ...input(), id: randomUUID(), confirmPaid: true }; await h.run(body);
  assert.equal(h.p.job.status, "failed"); assert.match(h.p.job.error, /等待生成超时/);
  assert.equal(h.p.modelTrials[0].video.taskId, "slow-wan");
  done = true; await h.post(`/projects/${h.p.id}/trials/${body.id}/resume`, {}); await h.router.engine.active.get(h.p.id);
  assert.equal(h.p.job.status, "completed", h.p.job.error); assert.equal(submissions, 1);
});

test("new service configuration stays private; empty probes do not imply live model access", async t => {
  let calls = 0;
  const root = tmp(t), s = createSettings(root, deps({ settingsFetch: () => { calls++; throw new Error("unexpected"); } }));
  s.update({ services: { wan: { apiKey: "private-wan" }, minimax: { apiKey: "private-h3" } } });
  assert.equal(s.view().services.wan.model, "wan3.0-video"); assert.equal(s.view().services.minimax.maxDuration, 15);
  assert.doesNotMatch(JSON.stringify(s.view()), /private-wan|private-h3/);
  assert.equal((await s.probe("wan")).ok, null); assert.equal((await s.probe("minimax")).ok, null); assert.equal(calls, 0);
  const restored = createSettings(root, deps()); assert.equal(restored.config("minimax").apiKey, "private-h3");
  assert.throws(() => s.update({ services: { wan: { baseUrl: "https://other.example" } } }), /重新输入/);
  assert.throws(() => s.update({ services: { minimax: { baseUrl: "https://other.example", apiKey: "new" } } }, { hasMediaTasks: true }), /绑定/);
});

test("attachment credential import changes only named services and leaves no partial updates", t => {
  const { importKeys } = require("../tools/import-model-keys.cjs");
  const root = tmp(t), source = path.join(root, "api-export.txt"), s = createSettings(root, deps());
  s.update({ services: { text: { apiKey: "keep-text" } }, agents: { assets: "keep direction" } });
  fs.writeFileSync(source, 'DASHSCOPE_KEY = "sk-test-wan"\nMINIMAX_KEY = "sk-test-h3"');
  assert.deepEqual(importKeys(source, root), { wanConfigured: true, minimaxConfigured: true, restartRequired: true });
  const saved = createSettings(root, deps());
  assert.equal(saved.config("wan").apiKey, "sk-test-wan"); assert.equal(saved.config("text").apiKey, "keep-text");
  assert.equal(saved.view().agents.assets, "keep direction");
  const before = fs.readFileSync(path.join(root, "settings.json"), "utf8");
  fs.writeFileSync(source, 'DASHSCOPE_KEY = "sk-only-one"');
  assert.throws(() => importKeys(source, root), /no settings were changed/);
  assert.equal(fs.readFileSync(path.join(root, "settings.json"), "utf8"), before);
});

test("after restart, a persisted H3 task retains model ownership and only GETs upstream", async t => {
  const h = await harness(t, async () => { throw new Error("not used"); });
  const body = input({ provider: "minimax", duration: 15, resolution: "2K" });
  h.p.modelTrials = [{ id: randomUUID(), input: body, ...buildVideoRequest(body), video: { id: randomUUID(), provider: "minimax", baseUrl: MODELS.minimax.baseUrl, model: "MiniMax-H3", taskId: "old-h3", state: "processing" } }];
  h.p.ledger.push(h.p.modelTrials[0].video); h.router.store.save(h.p);
  const calls = [];
  const restored = createDramaRouter(deps({ settingsFetch: async (url, init) => { calls.push({ url, method: init.method }); return response({ task: { status: "succeeded", content: { url: "https://cdn.example/recovered.mp4" } } }); },
    remoteContent: async (_url, _private, o) => fs.writeFileSync(o.destination, "video"), probe: async () => ({ videoCodec: "h264" }) }), { root: h.root });
  const p = restored.store.get(h.p.id);
  restored.engine.startTrial(p, p.modelTrials[0]); await restored.engine.active.get(p.id);
  assert.equal(p.job.status, "completed", p.job.error);
  assert.deepEqual(calls, [{ url: `${MODELS.minimax.baseUrl}/v2/query/video_generation/old-h3`, method: "GET" }]);
  const disk = JSON.parse(fs.readFileSync(restored.store.file(p.id), "utf8"));
  assert.equal(disk.ledger[0].file, disk.modelTrials[0].video.file);
});
