"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { createSettings } = require("../drama-settings");
const { createStore, createDramaRouter } = require("../drama-router");
const { createEngine } = require("../drama-engine");
const { preflight, workspace } = require("../drama-workspace");
function tmp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sirihotdrama-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function deps(extra = {}) { return { getGatewayConfig: () => ({ baseUrl: "https://text.example/v1", apiKey: "text-secret", model: "test-model", reasoningEffort: "high" }),
  getViduConfig: () => ({ baseUrl: "https://vidu.example", apiKey: "vidu-secret" }), ...extra }; }
function project(store) {
  const p = { id: randomUUID(), title: "Test drama", brief: "", rightsConfirmed: true, aspectRatio: "9:16", audio: true, assets: [], episodes: [], deliveries: [], ledger: [], events: [] };
  store.save(p); return p;
}
function file(store, p, name) { const out = store.file(p.id, name); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, "fixture"); return name; }

test("settings persist locally, redact keys, preserve blank secrets and reject invalid changes atomically", t => {
  const root = tmp(t), s = createSettings(root, deps());
  assert.equal(s.view().services.text.source, "inherited");
  assert.doesNotMatch(JSON.stringify(s.view()), /text-secret|vidu-secret|apiKey/);
  s.update({ services: { text: { baseUrl: "https://text.example/v1/", model: "selected-model", apiKey: "" } } });
  assert.equal(s.config("text").apiKey, "text-secret");
  assert.equal(createSettings(root, deps()).config("text").model, "selected-model");
  const before = fs.readFileSync(path.join(root, "settings.json"), "utf8");
  assert.throws(() => s.update({ services: { text: { baseUrl: "https://other.example/v1" } } }), /重新输入/);
  assert.throws(() => s.update({ services: { text: { baseUrl: "https://user:secret@text.example/v1" } } }), /不得包含/);
  assert.throws(() => s.update({ agents: { analyze: "a".repeat(4001) } }), /超过/);
  assert.equal(fs.readFileSync(path.join(root, "settings.json"), "utf8"), before);
  s.update({ services: { text: { baseUrl: "https://other.example/v1", apiKey: "new-text-secret" } } });
  assert.equal(s.config("text").apiKey, "new-text-secret");
  assert.doesNotMatch(JSON.stringify(s.view()), /new-text-secret/);
});

test("settings lock during execution and preserve the endpoint owning historical media task IDs", t => {
  const s = createSettings(tmp(t), deps());
  assert.throws(() => s.update({ agents: { assets: "change" } }, { active: true }), /运行中/);
  assert.throws(() => s.update({ services: { vidu: { baseUrl: "https://another.example", apiKey: "new" } } }, { hasMediaTasks: true }), /绑定/);
  s.update({ services: { vidu: { apiKey: "rotated" } } }, { hasMediaTasks: true });
  assert.equal(s.config("vidu").apiKey, "rotated");
});

test("runtime uses saved Vidu Token and Responses Bearer configuration, with redirects disabled", async t => {
  const calls = [];
  const s = createSettings(tmp(t), deps({ settingsFetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ task_id: "task-1", state: "processing" }) }; },
    normalizeViduTask: d => ({ taskId: d.task_id, state: d.state }), requestGatewayResponse: (url, _body, options) => options.fetchImpl(url, { method: "POST", headers: options.headers }),
    requestVidu: async () => "inherited" }));
  assert.equal(await s.runtime.requestVidu("/old", {}), "inherited");
  s.update({ services: { vidu: { apiKey: "saved-vidu" }, text: { model: "custom-model", apiKey: "saved-text" } } });
  await s.runtime.requestVidu("/ent/v2/img2video", { method: "POST", body: "{}" });
  await s.runtime.getViduTask("task-1");
  const c = s.runtime.getGatewayConfig();
  await s.runtime.requestGatewayResponse(`${c.baseUrl}/responses`, {}, { headers: { Authorization: `Bearer ${c.apiKey}` } });
  assert.equal(c.model, "custom-model");
  assert.equal(calls[0].init.headers.Authorization, "Token saved-vidu");
  assert.equal(calls[1].url, "https://vidu.example/ent/v2/tasks/task-1/creations");
  assert.equal(calls[2].init.headers.Authorization, "Bearer saved-text");
  assert.ok(calls.every(c => c.init.redirect === "error"));
});

test("connectivity probes never generate and distinguish unverified config from available model listing", async t => {
  const calls = [];
  const s = createSettings(tmp(t), deps({ settingsFetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ data: [{ id: "test-model" }] }) }; } }));
  assert.equal((await s.probe("vidu")).ok, null);
  assert.equal(calls.length, 0);
  assert.equal((await s.probe("text")).ok, true);
  assert.equal(calls[0].url, "https://text.example/v1/models");
  assert.equal(calls[0].init.method, undefined);
  assert.equal(calls[0].init.redirect, "error");
});

test("creative settings snapshot is immutable and agent direction reaches the actual engine request", async t => {
  const root = tmp(t), store = createStore(root), s = createSettings(root, deps()), p = project(store);
  s.update({ agents: { analyze: "Snapshot marker" }, styles: { cinematic: "cool daylight" } });
  p.creativeSettings = s.creative();
  s.update({ agents: { analyze: "New marker" }, styles: { cinematic: "night" } });
  assert.equal(p.creativeSettings.styles.cinematic, "cool daylight");
  const prompts = [];
  p.episodes.push({ id: randomUUID(), number: 1, file: "source.mp4", shots: [], transcript: "" });
  const engine = createEngine({ extractShots: async (_f, dir) => {
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "f.jpg"), Buffer.from([255, 216]));
    return { metadata: { duration: 5 }, shots: [{ start: 0, end: 5, frames: [{ file: "f.jpg", time: 1 }] }] };
  }, llm: async prompt => {
    prompts.push(prompt);
    if (prompt.includes('"shots":[')) return { shots: [{ id: prompt.match(/"id":"([a-f0-9-]{36})"/)[1], action: "Test", scene: "room", camera: "fixed", characters: [], props: [], evidence: "visible" }] };
    return { summary: "Test summary" };
  } }, store);
  engine.start(p, "analyze"); await engine.active.get(p.id);
  assert.equal(p.job.status, "completed", p.job.error);
  assert.ok(prompts.length > 0 && prompts.every(p => p.includes("Snapshot marker") && !p.includes("New marker")));
});

test("preflight counts only known units, verifies files, separates reuse/resume/blocked and preserves speech", t => {
  const store = createStore(tmp(t)), p = project(store);
  p.production = { referenceModel: "viduq4-preview", imageModel: "viduq4-preview", generationSeconds: 16, resolution: "2K", editPolicy: "complete-generated-clips" };
  const asset = { id: randomUUID(), type: "character", name: "Lead", image: { id: randomUUID(), state: "success", file: file(store, p, "generated/lead.png") } }; p.assets.push(asset);
  const ep = { id: randomUUID(), number: 1, file: "source.mp4", sourceShots: [], shots: [
    { id: "a", mode: "reference2video", start: 0, end: 16, prompt: "test", assetIds: [asset.id], video: { state: "success", file: file(store, p, "generated/a.mp4") } },
    { id: "b", mode: "img2video", start: 16, end: 32, prompt: "test", assetIds: [asset.id], frame: { taskId: "frame-task", state: "processing" }, video: { state: "unknown" } },
    { id: "c", mode: "reference2video", start: 32, end: 48, prompt: "test", assetIds: [asset.id], video: { taskId: "paid-task", state: "processing" } },
  ] }; p.episodes.push(ep);
  const plan = preflight(p, "all", [ep.id], store);
  assert.deepEqual(plan.images, { new: 0, reuse: 1, resume: 1, blocked: 0 });
  assert.deepEqual(plan.videos, { new: 0, reuse: 1, resume: 1, blocked: 1 });
  assert.equal(plan.reference, 2); assert.equal(plan.firstFrame, 1); assert.equal(plan.totalSeconds, 48); assert.equal(plan.preserveSpeech, true);
  assert.ok(plan.blockers.some(s => /未知/.test(s)));
  assert.ok(preflight(p, "assemble", [ep.id], store).blockers.length);
  delete ep.sourceShots;
  assert.equal(preflight(p, "all", [ep.id], store).unresolvedPlanning, true);
  assert.throws(() => preflight(p, "all", [], store));
});

test("workspace binds asset descriptions by ID and omits missing files without mutating project data", t => {
  const root = tmp(t), store = createStore(root), p = project(store);
  p.assets = ["Alice", "Bob"].map(name => ({ id: randomUUID(), type: "character", name, prompt: `${name} description`, image: { id: randomUUID(), file: file(store, p, `generated/${name}.png`) } }));
  p.assets.push({ id: "missing", type: "character", name: "Missing", image: { file: "missing.png" } }); store.save(p);
  const before = fs.readFileSync(store.file(p.id), "utf8");
  const result = workspace(store, root, {});
  assert.equal(result.items.length, 2);
  assert.equal(result.items.find(i => i.title === "Alice").description, "Alice description");
  assert.equal(result.items.find(i => i.title === "Bob").file, "generated/Bob.png");
  assert.equal(fs.readFileSync(store.file(p.id), "utf8"), before);
});

test("authored all-stage execution skips fabricated source analysis and keeps completed media reusable", async t => {
  const store = createStore(tmp(t)), p = project(store);
  p.sourceKind = "user-script-and-portrait";
  p.episodes.push({ id: randomUUID(), number: 1, shots: [{ id: "s", start: 0, end: 5, included: true, analysis: { action: "script" }, prompt: "test", imagePrompt: "test", assetIds: [], frame: { file: file(store, p, "generated/f.png") }, video: { file: file(store, p, "generated/v.mp4"), metadata: { videoCodec: "h264" } } }] });
  p.deliveries.push({ episodeId: p.episodes[0].id, stale: false });
  const engine = createEngine({ requestVidu: () => assert.fail("must not rebill"), llm: () => assert.fail("must not analyze nonexistent footage") }, store);
  engine.start(p, "all"); await engine.active.get(p.id);
  assert.equal(p.job.status, "completed", p.job.error);
  assert.ok(!p.events.some(e => e.message === "开始 Agent 1"));
  assert.throws(() => engine.start(p, "analyze"), /没有原片/);
});

test("HTTP settings enforce local origin, snapshot new projects, lock active jobs and hide keys", async t => {
  const router = createDramaRouter(deps(), { root: tmp(t) });
  const server = http.createServer((req, res) => router.route(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/drama`;
  const request = (route, body, method = "POST", headers = {}) => fetch(base + route, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await request("/settings", {}, "PATCH", { Origin: "https://evil.example" })).status, 403);
  const r = await request("/settings", { agents: { analyze: "new instruction" } }, "PATCH");
  assert.equal(r.status, 200); assert.doesNotMatch(await r.text(), /text-secret|vidu-secret/);
  const p = await (await request("/projects", { title: "new" })).json();
  assert.equal(p.creativeSettings.agents.analyze, "new instruction");
  router.engine.active.set(p.id, true);
  assert.equal((await request("/settings", {}, "PATCH")).status, 409);
  router.engine.active.clear();
  const old = router.store.get(p.id); old.archived = true; old.ledger.push({ taskId: "old-task" }); router.store.save(old);
  assert.equal((await request("/settings", { services: { vidu: { baseUrl: "https://other.example", apiKey: "new-key" } } }, "PATCH")).status, 409);
  assert.equal((await fetch(base + `/files/${p.id}/../settings.json`)).status, 404);
});
