"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const media = require("../drama-media");
const { createStore, createDramaRouter } = require("../drama-router");
const { createEngine } = require("../drama-engine");
const { isPrivateAddress } = require("../server");
const exec = promisify(execFile);
const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-drama-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
function project(store) {
  const p = { id: randomUUID(), title: "Test", brief: "test", rightsConfirmed: true, aspectRatio: "9:16", videoMode: "img2video", maxShotSeconds: 8, audio: true, assets: [], episodes: [], deliveries: [], ledger: [], events: [], createdAt: new Date().toISOString() };
  store.save(p); return p;
}
function mocks() {
  let submissions = 0;
  const deps = {
    isPrivateAddress, pollIntervalMs: 0, pollTimeoutMs: 1000,
    requestVidu: async (_route, opts) => { submissions++; const payload = JSON.parse(opts.body); return { task_id: `task-${submissions}`, model: payload.model, state: "created" }; },
    normalizeViduTask: t => ({ taskId: t.task_id, state: t.state, model: t.model }),
    getViduTask: async taskId => ({ taskId, state: "success", credits: 3, creations: [{ url: "https://example.com/result.mp4" }] }),
    remoteContent: async (_url, _check, opts) => { fs.writeFileSync(opts.destination, Buffer.from([0xff, 0xd8, 0xff, 1])); },
    probe: async () => ({ duration: 5, width: 720, height: 1280, hasAudio: true }),
    extractShots: async (_file, dir) => { fs.mkdirSync(dir, { recursive: true }); for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(dir, `${i}.jpg`), Buffer.from([0xff, 0xd8])); return { metadata: { duration: 5 }, shots: [{ start: 0, end: 5, boundary: "time-window", frames: [0, 1, 2].map(i => ({ file: `${i}.jpg`, time: i + 0.5 })) }] }; },
    llm: async prompt => {
      if (prompt.includes('"shots":[')) { const shotId = prompt.match(/"id":"([a-f0-9-]{36})"/)?.[1]; return { shots: [{ id: shotId, action: "A person turns", scene: "room", characters: ["A"], props: [], environment: "room", dialogue: "未知", camera: "close up", evidence: "frames" }] }; }
      if (prompt.includes('"assets":[')) return { prompt: "Person turns toward the light", imagePrompt: "Portrait", assets: [{ name: "A", type: "character", prompt: "Portrait of A" }] };
      return { summary: "A person turns in a room" };
    },
    assemble: async (_clips, out) => { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, "video"); return { duration: 5, width: 720, height: 1280 }; },
  };
  return { deps, count: () => submissions };
}
test("catalog parses public Hongguo heat without claiming play counts or invented video URLs", () => {
  const html = `<article aria-labelledby="rank-title-123"><a href="/detail?series_id=123"><h2>Example</h2></a><img src="https://example.com/poster.jpg"><p class="pc-metrics-abc">7850万热度</p><p class="pc-description-a">Description</p><a aria-label="播放第1集" href="/player/123">1</a><a aria-label="播放第2集">2</a></article>`;
  const [row] = media.parseCatalog(html, "text/html", "https://hongguoduanju.com/rank/hot-drama");
  assert.equal(row.heat, 78500000); assert.equal(row.playCount, null);
  assert.equal(row.episodes[0].pageUrl, "https://hongguoduanju.com/player/123");
  assert.equal(row.episodes[0].videoUrl, ""); assert.equal(row.episodes[1].pageUrl, "");
});
test("catalog handles JSON-LD episodes and missing covers without converting empty strings to page URLs", () => {
  const [row] = media.parseCatalog(JSON.stringify({ "@type": "VideoObject", name: "Ep 1", contentUrl: "https://example.com/1.mp4" }), "application/json", "https://example.com/show");
  assert.equal(row.coverUrl, ""); assert.equal(row.episodes.length, 1); assert.equal(row.episodes[0].videoUrl, "https://example.com/1.mp4");
  assert.equal(media.numericMetric("1.2亿"), 120000000); assert.equal(media.numericMetric("not a count"), null);
});
test("Hongguo detail links attach observed episode pages without evaluating page scripts", () => {
  const html = `<script type="application/ld+json">{"@type":"TVSeries","name":"Series","image":"https://example.com/cover.png"}</script><a href="/player/123">播放正片</a><a href="/player/123">1</a><a href="/player/123/456">2</a>`;
  const [row] = media.parseCatalog(html, "text/html", "https://hongguoduanju.com/detail?series_id=123");
  assert.equal(row.episodes.length, 2); assert.equal(row.episodes[1].pageUrl, "https://hongguoduanju.com/player/123/456"); assert.equal(row.episodes[0].videoUrl, ""); assert.equal(row.coverUrl, "https://example.com/cover.png");
});
test("shot windows cover full episode, remain bounded and do not invent duration", () => {
  const windows = media.shotWindows(33.123, [0.1, 0.2, 6.2, 6.2, 19, 33.1], 8);
  assert.equal(windows[0].start, 0); assert.equal(windows.at(-1).end, 33.123);
  windows.forEach((s, i) => { assert.ok(s.end - s.start <= 8.001); assert.ok(s.end > s.start); if (i) assert.equal(s.start, windows[i - 1].end); });
});
test("remote collection blocks local addresses and unsupported protocols", async () => {
  assert.throws(() => media.publicUrl("file:///etc/passwd"));
  await assert.rejects(media.remoteContent("http://127.0.0.1:4328/", isPrivateAddress), /内网/);
  await assert.rejects(media.remoteContent("http://[::ffff:127.0.0.1]/", isPrivateAddress), /内网/);
});
test("Agent 1 resolves a public episode before analysis and refuses an empty run selection", async t => {
  const store = createStore(tmp(t)), p = project(store), { deps } = mocks(); let imported = 0;
  deps.importEpisode = async (_p, ep) => { imported++; ep.file = "imported.mp4"; };
  p.episodes.push({ id: randomUUID(), number: 1, pageUrl: "https://example.com/player/1", shots: [] });
  const engine = createEngine(deps, store);
  assert.throws(() => engine.start(p, "analyze", []), /分集范围/);
  engine.start(p, "analyze", [p.episodes[0].id]); await engine.active.get(p.id);
  assert.equal(imported, 1); assert.equal(p.job.status, "completed", p.job.error); assert.ok(p.episodes[0].summary);
});
test("pause retains an accepted task ID and resume does not create a second task", async t => {
  const store = createStore(tmp(t)), p = project(store), { deps, count } = mocks();
  p.job = {}; const target = {}; p.assets.push(target);
  const submit = deps.requestVidu;
  deps.requestVidu = async (...args) => { const task = await submit(...args); p.job.stopRequested = true; return task; };
  const engine = createEngine(deps, store);
  await assert.rejects(engine.generated(p, target, "image", "/image", {}, ".png"), /暂停/);
  assert.equal(target.image.taskId, "task-1"); assert.equal(count(), 1);
  p.job.stopRequested = false; await engine.generated(p, target, "image", "/image", {}, ".png");
  assert.equal(count(), 1); assert.equal(target.image.state, "success");
});
test("store persists and detects interrupted jobs; file paths cannot escape project", t => {
  const root = tmp(t), store = createStore(root), p = project(store);
  p.job = { status: "running" }; store.save(p);
  assert.equal(createStore(root).get(p.id).job.status, "interrupted");
  assert.throws(() => store.file(p.id, "../outside")); assert.throws(() => store.file(p.id, "C:\\Windows\\win.ini"));
});
test("four-agent pipeline creates reference assets, frames, video and delivery; rerun never resubmits completed work", async t => {
  const store = createStore(tmp(t)), p = project(store), { deps, count } = mocks(), engine = createEngine(deps, store);
  p.episodes.push({ id: randomUUID(), number: 1, file: "input.mp4", shots: [], transcript: "" }); store.save(p);
  engine.start(p, "all"); await engine.active.get(p.id);
  assert.equal(p.job.status, "completed", p.job.error); assert.equal(count(), 3);
  assert.equal(p.assets.length, 1); assert.equal(p.episodes[0].shots[0].assetIds[0], p.assets[0].id); assert.equal(p.deliveries.length, 1);
  assert.ok(fs.existsSync(store.file(p.id, p.deliveries[0].file)));
  engine.start(p, "all"); await engine.active.get(p.id);
  assert.equal(count(), 3); assert.equal(p.deliveries.length, 1);
});
test("ambiguous billed submissions persist unknown state and do not submit again", async t => {
  const store = createStore(tmp(t)), p = project(store), { deps } = mocks(); let calls = 0;
  deps.requestVidu = async () => { calls++; throw new Error("network reset"); };
  p.job = {}; const target = {}; p.assets.push(target); const engine = createEngine(deps, store);
  await assert.rejects(engine.generated(p, target, "image", "/image", { model: "viduimage-2" }, ".png"), /network reset/);
  assert.equal(target.image.state, "unknown");
  await assert.rejects(engine.generated(p, target, "image", "/image", {}, ".png"), /未知/);
  assert.equal(calls, 1); assert.equal(createStore(path.dirname(path.dirname(store.file(p.id)))) .get(p.id).assets[0].image.state, "unknown");
});
test("resume existing task after restart polls its ID and synchronizes durable ledger", async t => {
  const root = tmp(t), store = createStore(root), p = project(store), { deps, count } = mocks();
  p.job = {}; p.assets.push({ image: { id: randomUUID(), taskId: "existing", state: "processing" } }); p.ledger.push(p.assets[0].image); store.save(p);
  const loadedStore = createStore(root), loaded = loadedStore.get(p.id), engine = createEngine(deps, loadedStore);
  await engine.generated(loaded, loaded.assets[0], "image", "/image", {}, ".png");
  assert.equal(count(), 0); assert.equal(loaded.ledger[0].state, "success"); assert.ok(loaded.ledger[0].file);
});
test("Q4 reference mode sends generated frame plus character reference without losing aspect ratio", async t => {
  const store = createStore(tmp(t)), p = project(store), { deps } = mocks(), requests = [];
  const submit = deps.requestVidu; deps.requestVidu = async (route, opts) => { requests.push({ route, payload: JSON.parse(opts.body) }); return submit(route, opts); };
  p.videoMode = "reference2video"; p.episodes.push({ id: randomUUID(), number: 1, file: "input.mp4", shots: [] });
  const engine = createEngine(deps, store); engine.start(p, "all"); await engine.active.get(p.id);
  assert.equal(p.job.status, "completed", p.job.error);
  const video = requests.find(r => r.route === "/ent/v2/reference2video"); assert.ok(video); assert.equal(video.payload.images.length, 2); assert.equal(video.payload.aspect_ratio, "9:16"); assert.equal(video.payload.model, "viduq4");
});
test("HTTP routes reject cross-origin writes, preserve user edits, and invalidate downstream outputs", async t => {
  const { deps } = mocks(); const router = createDramaRouter(deps, { root: tmp(t) });
  const server = http.createServer((req, res) => router.route(req, res)); await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise(r => server.close(r))); const base = `http://127.0.0.1:${server.address().port}/api/drama`;
  assert.equal((await fetch(`${base}/projects`, { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" })).status, 403);
  const p = router.store.save(project(router.store)); const sid = randomUUID(), eid = randomUUID();
  p.episodes.push({ id: eid, number: 1, shots: [{ id: sid, prompt: "old", frame: { file: "frame.png" }, video: { file: "video.mp4" } }] }); p.deliveries.push({ episodeId: eid, stale: false }); router.store.save(p);
  const same = await fetch(`${base}/projects/${p.id}/shots/${sid}`, { method: "PATCH", body: JSON.stringify({ prompt: "old" }) });
  const unchanged = await same.json(); assert.equal(unchanged.deliveries[0].stale, false); assert.ok(unchanged.episodes[0].shots[0].video);
  const invalidEdit = await fetch(`${base}/projects/${p.id}/episodes/${eid}`, { method: "PATCH", body: JSON.stringify({ title: "Changed", number: -1 }) });
  assert.equal(invalidEdit.status, 400); assert.equal(p.episodes[0].title, undefined);
  const r = await fetch(`${base}/projects/${p.id}/shots/${sid}`, { method: "PATCH", body: JSON.stringify({ prompt: "new" }) }); const edited = await r.json();
  assert.equal(r.status, 200); assert.equal(edited.episodes[0].shots[0].prompt, "new"); assert.equal(edited.episodes[0].shots[0].video, undefined); assert.ok(edited.episodes[0].shots[0].frame); assert.ok(edited.deliveries[0].stale);
});
test("episode capacity rejects extra uploads but permits replacing an existing episode", async t => {
  const { deps } = mocks(); const router = createDramaRouter(deps, { root: tmp(t) });
  const server = http.createServer((req, res) => router.route(req, res)); await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise(r => server.close(r)));
  const p = project(router.store); p.episodes = Array.from({ length: 100 }, (_, i) => ({ id: randomUUID(), number: i + 1, shots: [] })); router.store.save(p);
  const url = `http://127.0.0.1:${server.address().port}/api/drama/projects/${p.id}/episodes`;
  assert.equal((await fetch(url, { method: "POST", body: "video" })).status, 400);
  const response = await fetch(`${url}?replace=${p.episodes[0].id}`, { method: "POST", body: "video" });
  assert.equal(response.status, 201); const updated = await response.json(); assert.equal(updated.episodes.length, 100); assert.ok(updated.episodes[0].file);
});
test("FFmpeg assembles silent and audio clips into a playable video with the requested aspect and duration", { timeout: 60000 }, async t => {
  const dir = tmp(t), silent = path.join(dir, "silent.mp4"), sound = path.join(dir, "sound.mp4");
  await exec("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x240:r=24", "-t", "1", "-c:v", "libx264", silent], { windowsHide: true });
  await exec("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=green:s=320x240:r=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-c:a", "aac", sound], { windowsHide: true });
  const result = await media.assemble([{ file: silent, duration: 0.5 }, { file: sound, duration: 0.75 }], path.join(dir, "assembled", "final.mp4"), "9:16");
  assert.equal(result.width, 720); assert.equal(result.height, 1280); assert.ok(result.hasAudio); assert.ok(result.duration >= 1.2 && result.duration < 1.6);
  const frames = await media.extractShots(silent, path.join(dir, "frames"), 8); assert.equal(frames.shots.length, 1); assert.equal(frames.shots[0].frames.length, 3);
  const production = await media.assemble([{ file: sound, duration: 0.5 }], path.join(dir, "2k", "final.mp4"), "9:16", "2K");
  assert.equal(production.width, 1440); assert.equal(production.height, 2560); assert.ok(production.hasAudio);
  await assert.rejects(media.assemble([{ file: sound, duration: 16 }], path.join(dir, "short", "final.mp4"), "9:16", "2K"), /短于计划/);
});
