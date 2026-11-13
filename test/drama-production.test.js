"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { createEngine } = require("../drama-engine");
const { createStore, createDramaRouter } = require("../drama-router");
const { buildUnits, relativeBeats, productionConfig, videoPayload, ensurePayload, bounded, createProduction } = require("../drama-production");
const media = require("../drama-media");
const temp = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-production-test-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };
const source = duration => media.shotWindows(duration, [2, 6, 9, 28, 46], 5).map((s, i) => ({ ...s, id: randomUUID(), frames: [], analysis: { scene: "room", action: `beat ${i}`, characters: ["A"], camera: i === 1 ? "连续跟拍" : "特写" } }));
const make = store => store.save({ id: randomUUID(), title: "Production test", brief: "test", aspectRatio: "9:16", audio: true, videoMode: "img2video", rightsConfirmed: true,
  production: { ...productionConfig({}), bible: { identities: [], premise: "test", continuity: "test" } }, assets: [], episodes: [], deliveries: [], events: [], ledger: [] });

test("production fixes both routes to Q4 Preview and 16 seconds without silently accepting Q3", () => {
  const config = productionConfig({});
  assert.equal(config.referenceModel, "viduq4-preview"); assert.equal(config.imageModel, "viduq4-preview"); assert.equal(config.generationSeconds, 16);
  assert.throws(() => productionConfig({ referenceModel: "viduq3.1-ad" }));
  assert.throws(() => productionConfig({ imageModel: "viduq4" }));
});

test("full episode windows retain every source beat, bound microshots, and round reference share by unit count", () => {
  for (const duration of [2, 16, 32, 148.352585, 201.735011, 193.3]) {
    const shots = source(duration), units = buildUnits(shots);
    assert.equal(units.length, Math.ceil(duration / 16)); assert.equal(units[0].start, 0); assert.equal(units.at(-1).end, shots.at(-1).end);
    assert.equal(units.filter(s => s.mode === "reference2video").length, Math.round(units.length * 0.7));
    units.forEach((s, i) => {
      assert.ok(s.end - s.start <= 16.001); if (i) assert.equal(s.start, units[i - 1].end);
      assert.equal(s.beats[0].start, s.start); assert.equal(s.beats.at(-1).end, s.end);
      s.beats.forEach((b, j) => { assert.ok(b.end - b.start <= 5.001); if (j) assert.equal(b.start, s.beats[j - 1].end); });
      const relative = relativeBeats(s); assert.equal(relative[0].start, 0); assert.ok(relative.at(-1).end <= 16.001); assert.equal(relative[0].sourceStart, s.start);
    });
    assert.deepEqual(new Set(units.flatMap(u => u.sourceShotIds)), new Set(shots.map(s => s.id)));
  }
  const gap = source(20); gap[1].start += 1; assert.throws(() => buildUnits(gap), /缺口/);
});

test("reference uses only assets; I2V uses exactly its first frame; both request 16s 2K with audio", () => {
  const p = { production: productionConfig({}), aspectRatio: "9:16", audio: true };
  for (const mode of ["reference2video", "img2video"]) {
    const payload = videoPayload(p, { mode, start: 0, end: 8, prompt: "perform" }, [{ name: "A", image: "asset" }], "frame");
    assert.equal(payload.model, "viduq4-preview"); assert.equal(payload.duration, 16); assert.equal(payload.resolution, "2K"); assert.equal(payload.audio, true);
    assert.deepEqual(payload.images, [mode === "reference2video" ? "asset" : "frame"]);
    if (mode === "reference2video") assert.equal(payload.aspect_ratio, "9:16");
  }
  assert.throws(() => videoPayload(p, { mode: "reference2video", prompt: "p" }, []), /缺少/);
  assert.throws(() => videoPayload(p, { mode: "img2video", prompt: "p" }, []), /首帧/);
  assert.throws(() => videoPayload(p, { mode: "img2video", prompt: "x".repeat(5000), start: 0, end: 16 }, [], "frame"), /5000/);
});

test("Preview supports 15 image references while enforcing the full 20MB request limit", () => {
  assert.equal(ensurePayload({ model: "viduq4-preview", images: Array(15).fill("image") }).images.length, 15);
  assert.throws(() => ensurePayload({ model: "viduq4-preview", images: Array(16).fill("image") }), /数量/);
  assert.throws(() => ensurePayload({ prompt: "x".repeat(20 * 1024 * 1024) }), /20MB/);
});

test("bounded queue waits for all in-flight work and keeps other successes on failure", async () => {
  let active = 0, max = 0; const completed = [];
  await assert.rejects(bounded([0, 1, 2, 3, 4], 2, async i => {
    active++; max = Math.max(max, active); await new Promise(r => setTimeout(r, 5)); active--;
    if (i === 1) throw new Error("bad unit"); completed.push(i);
  }), /1 个任务/);
  assert.equal(max, 2); assert.equal(active, 0); assert.deepEqual(completed.sort(), [0, 2, 3, 4]);
});

test("bounded queue stops new submissions after an unresolved upstream timeout", async () => {
  const started = [], completed = [];
  await assert.rejects(bounded([0, 1, 2, 3], 2, async i => {
    started.push(i);
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 5 : 20));
    if (i === 0) throw Object.assign(new Error("upstream still processing"), { statusCode: 504 });
    completed.push(i);
  }), /upstream still processing/);
  assert.deepEqual(started, [0, 1]); assert.deepEqual(completed, [1]);
});

test("production engine skips Ref first frames, isolates styles and resumes without re-billing", async t => {
  const store = createStore(temp(t)), p = make(store), requests = [];
  for (const [i, style] of ["anime2d", "cg3d"].entries()) {
    const asset = { id: randomUUID(), name: "A", type: "character", style, identityKey: "A", prompt: style };
    p.assets.push(asset);
    const units = buildUnits(source(16), i === 0 ? 1 : 0);
    Object.assign(units[0], { prompt: `${style} performance`, imagePrompt: `${style} image`, assetIds: [asset.id] });
    p.episodes.push({ id: randomUUID(), number: i + 1, file: "input.mp4", style, sourceShots: source(16), shots: units, narrative: { hook: "hook" }, summary: "summary", assetIds: [asset.id], metadata: { duration: 16 } });
  }
  const deps = {
    pollIntervalMs: 0, llm: async () => ({ verdict: "pass", style: "pass", story: "pass", issues: [], limitations: "sample only" }),
    requestVidu: async (endpoint, opts) => { const payload = JSON.parse(opts.body); requests.push({ endpoint, payload }); return { taskId: `task-${requests.length}`, state: "created", model: payload.model }; },
    normalizeViduTask: t => t,
    getViduTask: async taskId => ({ taskId, state: "success", model: null, credits: 20, creations: [{ url: "https://example.com/media" }] }),
    remoteContent: async (_url, _check, opts) => fs.writeFileSync(opts.destination, Buffer.from([0xff, 0xd8, 1])),
    conditionImage: async (file, output) => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(file, output); },
    sampleFrames: async (_file, dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "0.jpg"), Buffer.from([0xff, 0xd8])); return [{ file: "0.jpg", time: 1 }]; },
    probe: async () => ({ duration: 16, width: 1440, height: 2560, hasAudio: true }),
    assemble: async (_clips, output, _ratio, resolution) => { assert.equal(resolution, "2K"); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, "video"); return { duration: 16, width: 1440, height: 2560, hasAudio: true }; },
  };
  store.save(p); const engine = createEngine(deps, store); engine.start(p, "all"); await engine.active.get(p.id);
  assert.equal(p.job.status, "completed", p.job.error); assert.equal(requests.length, 5);
  assert.equal(p.episodes[0].shots[0].frame, undefined); assert.ok(p.episodes[1].shots[0].frame.file);
  assert.equal(p.deliveries.length, 2); assert.ok(p.ledger.every(r => r.model));
  assert.equal(p.deliveries[0].quality.audioReview, "待人工听审");
  const assetRequests = requests.filter(r => r.payload.model === "viduimage-2" && r.payload.images.length === 0);
  assert.equal(assetRequests.length, 2); assert.ok(assetRequests.every(r => r.payload.quality === "medium" && r.payload.resolution === "2K"));
  engine.start(p, "all"); await engine.active.get(p.id); assert.equal(requests.length, 5);
});

test("LLM 429 backoff retries saved analysis and never resubmits completed shots", async t => {
  const store = createStore(temp(t)), p = make(store); delete p.production;
  const shots = source(3); shots[0].analysis = undefined; p.episodes = [{ id: randomUUID(), number: 1, file: "source.mp4", shots, summary: "summary" }]; let calls = 0;
  const engine = createEngine({ rateLimitDelayMs: 0, llm: async () => { calls++; if (calls === 1) throw Object.assign(new Error("limited"), { statusCode: 429 }); return { shots: [{ id: shots[0].id, action: "A moves", characters: [] }] }; } }, store);
  engine.start(p, "analyze"); await engine.active.get(p.id);
  assert.equal(p.job.status, "completed", p.job.error); assert.equal(calls, 2); assert.ok(p.events.some(e => e.message.includes("限流")));
  engine.start(p, "analyze"); await engine.active.get(p.id); assert.equal(calls, 2);
});

test("parallel first-frame tasks share one atomic conditioning copy for a reused asset", async t => {
  const store = createStore(temp(t)), p = make(store), aid = randomUUID(); let compressed = 0, frames = 0;
  p.assets.push({ id: aid, style: "anime2d", type: "character", identityKey: "A", image: { file: "asset.png" } });
  fs.writeFileSync(store.file(p.id, "asset.png"), "image");
  const shots = buildUnits(source(32), 0).map(s => ({ ...s, prompt: "perform", imagePrompt: "frame", assetIds: [aid] }));
  p.episodes = [{ id: randomUUID(), number: 1, style: "anime2d", sourceShots: source(32), shots, narrative: { hook: "hook" }, assetIds: [aid] }];
  const production = createProduction({ store, deps: { conditionImage: async (_input, output) => {
    compressed++; await new Promise(r => setTimeout(r, 10)); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, "compressed");
  } }, llm: async () => { throw new Error("already planned"); }, generated: async (_p, s) => { frames++; s.frame = { file: "done.png" }; }, event: () => {}, checkpoint: () => {}, dataImage: (_p, file) => file });
  await production.assets(p, p.episodes); assert.equal(compressed, 1); assert.equal(frames, 2);
});

test("HEVC previews recover without resubmitting a paid video task and retain the original", async t => {
  const store = createStore(temp(t)), p = make(store); p.job = {};
  const s = { video: { id: randomUUID(), taskId: "paid-existing", model: "viduq4-preview", state: "success", file: "original.mp4" } };
  p.episodes = [{ shots: [s] }]; p.ledger = [s.video]; fs.writeFileSync(store.file(p.id, "original.mp4"), "hevc"); let attempts = 0;
  const engine = createEngine({ requestVidu: async () => { throw new Error("Must never submit"); },
    probe: async () => ({ videoCodec: "hevc", duration: 16, width: 1444, height: 2548, hasAudio: true }),
    browserPreview: async (_source, output) => { attempts++; if (attempts === 1) throw new Error("temporary encoder error"); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, "h264"); return { videoCodec: "h264", duration: 16 }; } }, store);
  await assert.rejects(engine.generated(p, s, "video", "/ent/v2/img2video", {}, ".mp4"), /转码失败/);
  assert.equal(s.video.file, "original.mp4"); assert.equal(s.video.state, "success");
  await engine.generated(p, s, "video", "/ent/v2/img2video", {}, ".mp4");
  assert.equal(s.video.previewState, "success"); assert.ok(s.video.previewFile); assert.equal(s.video.file, "original.mp4");
  await engine.generated(p, s, "video", "/ent/v2/img2video", {}, ".mp4"); assert.equal(attempts, 2);
});

test("planner retries only invalid units with precise feedback and keeps successful Ref units without first-frame prompts", async t => {
  const store = createStore(temp(t)), p = make(store), aid = randomUUID();
  p.assets = [{ id: aid, name: "A", type: "character", style: "anime2d", prompt: "A" }];
  const shots = buildUnits(source(32), 1);
  p.episodes = [{ number: 1, style: "anime2d", sourceShots: source(32), shots, assetIds: [aid], narrative: { hook: "hook" } }];
  let calls = 0;
  const production = createProduction({ deps: {}, store, checkpoint: () => {}, event: () => store.save(p), llm: async (_p, prompt) => {
    calls++;
    if (calls === 1) return { units: [
      { id: shots[0].id, title: "saved", prompt: "good", assetIds: [aid] },
      { id: shots[1].id, prompt: "repair", assetIds: ["invented-id"] },
    ] };
    assert.ok(shots[0].prompt.includes("good"), "Valid work must be persisted before retry");
    assert.ok(prompt.includes("invented-id") && prompt.includes("无效资产ID"));
    assert.ok(!prompt.includes(shots[0].id), "Do not replan successful units");
    return { units: [{ id: shots[1].id, title: "fixed", prompt: "repaired", assetIds: [aid] }] };
  } });
  await production.plan(p, p.episodes);
  assert.equal(calls, 2); assert.equal(shots[0].title, "saved"); assert.equal(shots[1].title, "fixed");
  assert.equal(p.episodes[0].planningIssue, undefined);
  await production.plan(p, p.episodes); assert.equal(calls, 2);
});

test("planner bounds invalid-response repair attempts and reports I2V first-frame requirements", async t => {
  const store = createStore(temp(t)), p = make(store), aid = randomUUID();
  p.assets = [{ id: aid, name: "A", type: "character", style: "anime2d", prompt: "A" }];
  const shots = buildUnits(source(16), 0);
  p.episodes = [{ number: 1, style: "anime2d", sourceShots: source(16), shots, assetIds: [aid], narrative: { hook: "hook" } }];
  let calls = 0;
  const production = createProduction({ deps: {}, store, checkpoint: () => {}, event: () => store.save(p), llm: async () => {
    calls++; return { units: [{ id: shots[0].id, prompt: "video", assetIds: [aid] }] };
  } });
  await assert.rejects(production.plan(p, p.episodes), /2次修正仍无效.*图生缺少首帧/);
  assert.equal(calls, 3); assert.equal(shots[0].prompt, undefined);
  assert.ok(p.episodes[0].planningIssue.errors[0].reasons.includes("图生缺少首帧提示词"));
});

test("continuous planner repairs only overlong speech and preserves valid units and asset identities", async t => {
  const store = createStore(temp(t)), p = make(store), aid = randomUUID();
  Object.assign(p.production, productionConfig({ continuity: true }));
  p.production.bible.premise = "现代城市里的同伴重逢";
  p.production.bible.identities = [{ key: "A", name: "A", identity: "same actor" }];
  p.assets = [{ id: aid, name: "A", type: "character", style: "cinematic", identityKey: "A", identityMasterId: aid, prompt: "same actor" }];
  const shots = buildUnits(source(32), 1), assetsBefore = JSON.stringify(p.assets);
  p.episodes = [{ number: 1, style: "cinematic", sourceShots: source(32), shots, assetIds: [aid], narrative: { hook: "hook" } }];
  const short = "薄被惹争执，她们却放不下回不去的家。", long = "一张旧床，两层薄被，也能让她们争上几句；真正压在心里的，却是回不去的生活。";
  let calls = 0;
  const production = createProduction({ deps: {}, store, checkpoint() {}, event: () => store.save(p), llm: async (_p, prompt) => {
    calls++;
    if (calls === 1) return { units: shots.map((s, i) => ({ id: s.id, title: `unit-${i}`, assetIds: [aid], prompt: "Same room, same positions.",
      lines: [{ start: 0.1, end: 3.2, kind: "narration", speaker: "画外旁白", text: i ? long : short }],
      continuity: { type: i ? "continue" : "cut", entryState: "A left", exitState: "A left", transition: "same room" },
    })) };
    assert.equal(calls, 2); assert.match(prompt, /targetMaxCharacters/);
    assert.ok(shots[0].speechScore); assert.ok(store.get(p.id).episodes[0].shots[0].prompt);
    assert.ok(!prompt.includes(shots[0].id));
    return { lines: [{ index: 0, text: short }] };
  } });
  await production.plan(p, p.episodes);
  assert.equal(calls, 2); assert.equal(JSON.stringify(p.assets), assetsBefore);
  assert.equal(shots[1].speechScore.repair.changes[0].originalText, long);
  assert.equal(shots[1].speechScore.lines[0].end, 3.2);
  assert.equal(shots[1].continuity.previousShotId, shots[0].id);
  assert.equal(p.episodes[0].planningIssue, undefined);
  for (const shot of shots) {
    assert.match(shot.prompt, /现代城市里的同伴重逢/);
    assert.doesNotMatch(shot.prompt, /七十年代乡村|蓝衣双辫女子|眼镜青年/);
  }
  await production.plan(p, p.episodes); assert.equal(calls, 2);
});

test("production-copy API preserves source project and rights; rejects missing analyses and unknown styles", async t => {
  const router = createDramaRouter({}, { root: temp(t) }), p = make(router.store); delete p.production; p.rightsConfirmed = false;
  const shots = source(16); fs.writeFileSync(router.store.file(p.id, "source.mp4"), "video");
  p.episodes = [{ id: randomUUID(), number: 1, file: "source.mp4", shots, summary: "summary" }]; router.store.save(p);
  const server = http.createServer((req, res) => router.route(req, res)); await new Promise(r => server.listen(0, "127.0.0.1", r)); t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api/drama/projects/${p.id}/production`;
  const post = body => fetch(url, { method: "POST", body: JSON.stringify(body) });
  assert.equal((await post({ episodes: [{ id: p.episodes[0].id, style: "unknown" }] })).status, 400);
  const response = await post({ episodes: [{ id: p.episodes[0].id, style: "anime2d" }] }); const copy = await response.json();
  assert.equal(response.status, 201); assert.notEqual(copy.id, p.id); assert.equal(copy.production.imageModel, "viduq4-preview"); assert.equal(copy.rightsConfirmed, false);
  assert.deepEqual(p.episodes[0].shots, shots); assert.equal(p.production, undefined); assert.ok(fs.existsSync(router.store.file(copy.id, "source.mp4")));
  delete p.episodes[0].shots[0].analysis;
  assert.equal((await post({ episodes: [{ id: p.episodes[0].id, style: "anime2d" }] })).status, 400);
});
