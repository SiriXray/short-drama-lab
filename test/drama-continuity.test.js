"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { productionConfig, createProduction, videoPayload, shotAssets } = require("../drama-production");
const { createStore, invalidateContinuations } = require("../drama-router");
const { createEngine } = require("../drama-engine");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const media = require("../drama-media");

test("continuous production keeps legacy configuration opt-in and reserves a complete speech tail", () => {
  assert.equal(productionConfig({}).editPolicy, undefined);
  const config = productionConfig({ continuity: true });
  assert.equal(config.editPolicy, "complete-generated-clips");
  assert.equal(config.speechDeadline, 14); assert.equal(config.pilotUnits, 2);
  assert.throws(() => productionConfig({ continuity: "false" }));
  const payload = videoPayload({ production: config, audio: true, aspectRatio: "9:16" }, { prompt: "speak", mode: "reference2video", start: 0, end: 14.835, continuity: { type: "continue" } }, [{ name: "tail", image: "tail" }]);
  assert.match(payload.prompt, /14.000秒前完成剧情及所有台词/);
  assert.match(payload.prompt, /上一段尾帧/);
  assert.equal(payload.duration, 16); assert.equal(payload.model, "viduq4-preview");
});

test("continuing I2V and Ref units wait for the actual predecessor, then stop at the pilot gate", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-continuity-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createStore(root), aid = randomUUID();
  const shots = [0, 1, 2].map((n) => ({ id: randomUUID(), start: n * 14.8, end: (n + 1) * 14.8, mode: n === 1 ? "img2video" : "reference2video", prompt: "required speech", speechScore: {}, assetIds: [aid], continuity: { type: n ? "continue" : "cut" } }));
  shots.forEach((s, i) => { s.continuity.previousShotId = shots[i - 1]?.id || null; });
  const p = store.save({ id: randomUUID(), title: "fixture", production: productionConfig({ continuity: true }), audio: true, aspectRatio: "9:16", episodes: [{ id: randomUUID(), number: 1, style: "cinematic", shots }], assets: [{ id: aid, name: "actor", style: "cinematic", image: { file: "asset.png" } }], ledger: [], events: [], deliveries: [] });
  fs.writeFileSync(store.file(p.id, "asset.png"), "image");
  const calls = [], tails = [];
  const production = createProduction({ store, checkpoint() {}, event() {}, dataImage: (_p, file) => `image:${file}`,
    deps: { conditionImage: async (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); },
      endingFrame: async (src, dst) => { assert.ok(fs.existsSync(src)); tails.push(src); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, "tail"); }, sampleFrames: async () => [] },
    llm: async () => ({ verdict: "pass", style: "cinematic", story: "fixture", issues: [] }),
    generated: async (_p, s, key, endpoint, payload) => {
      if (s[key]?.file) return;
      calls.push({ shotId: s.id, endpoint, payload });
      s[key] = { id: randomUUID(), taskId: randomUUID(), state: "success", file: `${s.id}.mp4`, metadata: { width: 1440, height: 2560, hasAudio: true, duration: 16 }, endpoint, model: payload.model };
      fs.writeFileSync(store.file(p.id, s[key].file), "video");
    } });
  await assert.rejects(production.videos(p, p.episodes), e => e.statusCode === 499);
  assert.equal(calls.length, 2); assert.equal(tails.length, 1);
  assert.equal(shots[1].frame.model, "continuity-frame");
  assert.equal(shots[1].continuity.anchor.taskId, shots[0].video.taskId);
  assert.equal(calls[1].payload.images.length, 1);
  assert.match(calls[1].payload.images[0], /tail/);
  p.production.pilotApproved = true;
  await production.videos(p, p.episodes);
  assert.equal(calls.length, 3); assert.equal(tails.length, 2);
  assert.match(calls[2].payload.images[0], /tail/);
  assert.equal(calls[2].payload.images.length, 2);
  await production.videos(p, p.episodes);
  assert.equal(calls.length, 3, "resume must not rebill completed units");
});

test("editing a predecessor invalidates dependent continuations but stops at a deliberate scene cut", () => {
  const shots = ["cut", "continue", "continue", "cut", "continue"].map(type => ({ video: { file: "old.mp4" }, qc: {}, frame: { model: "continuity-frame", file: "old.jpg" }, continuity: { type, anchor: {} } }));
  const p = { production: { continuity: true, pilotApproved: true } }, ep = { shots };
  invalidateContinuations(p, ep, 0);
  assert.equal(p.production.pilotApproved, undefined);
  for (const s of shots.slice(1, 3)) { assert.equal(s.video, undefined); assert.equal(s.frame, undefined); assert.equal(s.continuity.anchor, undefined); }
  assert.ok(shots[3].video && shots[4].video);
});

test("speech-preserving assembly does not pass source-window trimming durations", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-speech-assembly-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createStore(root), p = store.save({ id: randomUUID(), title: "fixture", rightsConfirmed: true, production: productionConfig({ continuity: true }), audio: true, aspectRatio: "9:16", assets: [], episodes: [{ id: randomUUID(), number: 1, style: "cinematic", metadata: { duration: 28 }, shots: [0, 1].map(n => ({ id: randomUUID(), start: n * 14, end: (n + 1) * 14, mode: "reference2video", video: { file: `${n}.mp4` }, qc: { verdict: "pass" } })) }], ledger: [], events: [], deliveries: [] });
  const engine = createEngine({ assemble: async (clips, output) => {
    assert.ok(clips.every(c => !Object.hasOwn(c, "duration")));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    return { duration: 32, width: 1440, height: 2560, hasAudio: true };
  } }, store);
  engine.start(p, "assemble"); await engine.active.get(p.id);
  assert.equal(p.job.status, "completed");
  assert.equal(p.deliveries[0].metadata.duration, 32);
  assert.equal(p.deliveries[0].quality.sourceDuration, 28);
  assert.equal(p.deliveries[0].quality.renderedDuration, 32);
});

test("real FFmpeg retains complete input audio duration and extracts a usable ending image", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-boundary-media-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, "source.mp4"), tail = path.join(root, "tail.jpg");
  await promisify(execFile)(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=144x256:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", input], { windowsHide: true });
  await media.endingFrame(input, tail);
  assert.ok(fs.statSync(tail).size > 1000);
  const result = await media.assemble([{ file: input }, { file: input }], path.join(root, "delivery/output.mp4"));
  assert.ok(result.duration >= 3 && result.duration < 3.2);
  assert.equal(result.hasAudio, true);
});

test("every costume variant includes the same character master, never a different face or style", () => {
  const master = { id: "main", type: "character", identityKey: "A", style: "cinematic", identityMasterId: "main" };
  const variant = { id: "dress", type: "character", identityKey: "A", style: "cinematic", identityMasterId: "main" };
  const p = { production: { continuity: true }, assets: [master, variant] };
  assert.deepEqual(shotAssets(p, { assetIds: ["dress"] }), [master, variant]);
  assert.deepEqual(shotAssets(p, { assetIds: ["main", "dress"] }), [master, variant]);
  master.style = "anime2d";
  assert.throws(() => shotAssets(p, { assetIds: ["dress"] }), /主参考图/);
  master.style = "cinematic"; master.identityKey = "B";
  assert.throws(() => shotAssets(p, { assetIds: ["dress"] }), /主参考图/);
});
