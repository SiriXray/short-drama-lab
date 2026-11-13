"use strict";
// Deterministic upstream substitutes for HTTP/browser regression tests; never used by the live server.
const fs = require("node:fs");
const path = require("node:path");
const { createDramaRouter } = require("../drama-router");
function fixture(root, mediaFiles = {}) {
  let router;
  const requests = [];
  const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  const putImage = file => mediaFiles.image ? (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.copyFileSync(mediaFiles.image, file)) : write(file, Buffer.from([255, 216, 255, 1]));
  const deps = {
    getGatewayConfig: () => ({ baseUrl: "https://mock.example/v1", apiKey: "mock-private", model: "mock-vision" }),
    getViduConfig: () => ({ baseUrl: "https://mock-vidu.example", apiKey: "mock-private" }),
    pollIntervalMs: 0, pollTimeoutMs: 1000,
    probe: async () => ({ duration: 32, width: 1440, height: 2560, hasAudio: true, videoCodec: "h264" }),
    extractShots: async (_file, dir) => {
      const shots = [0, 8, 16, 24].map((start, i) => ({ start, end: start + 8, boundary: "time-window", frames: [0, 1, 2].map(n => ({ file: `${i}-${n}.jpg`, time: start + n * 3 + 1 })) }));
      for (const shot of shots) for (const frame of shot.frames) putImage(path.join(dir, frame.file));
      return { metadata: { duration: 32, width: 1440, height: 2560, hasAudio: true }, shots };
    },
    llm: async prompt => {
      const p = router.store.list().map(p => router.store.get(p.id)).find(p => p.job?.status === "running");
      if (p.job.stage === "analyze") {
        if (prompt.includes('"shots":[')) return { shots: p.episodes.flatMap(e => e.shots).filter(s => !s.analysis).map(s => ({ id: s.id, action: "A woman opens a letter", scene: "A city office", camera: "Close-up", characters: ["Lead"], dialogue: "Unknown; no audio transcription", evidence: "Sampled frames", emotion: "surprise" })) };
        return { summary: "A letter changes the protagonist's decision." };
      }
      if (p.job.stage === "video") return { verdict: "pass", style: "photorealistic", story: "visible action", issues: [], limitations: "samples only" };
      if (!p.production.bible) return { premise: "A city office", identities: [{ key: "lead", name: "Lead", aliases: [], identity: "Adult woman, dark hair, same actor" }], continuity: "Same actor and wardrobe" };
      if (!p.episodes[0].narrative) return { narrative: { hook: "A letter", conflict: "A decision", uncertainties: "Original speech unknown" }, assets: [{ key: "lead", name: "Lead", identityKey: "lead", type: "character", prompt: "Photorealistic adult woman" }, { key: "room", name: "Office", type: "environment", prompt: "City office" }] };
      return { units: p.episodes.flatMap(e => e.shots).filter(s => !s.prompt).map(s => ({ id: s.id, title: "The letter", prompt: "The woman reads a letter and reacts.", imagePrompt: "Woman facing camera holding a letter in office.", assetIds: p.assets.map(a => a.id),
        lines: [{ start: 0.2, end: 3.5, speaker: "画外旁白", kind: "narration", text: "一封来信改变计划，她必须做出决定。" }],
        continuity: { type: "cut", entryState: "Woman seated left", exitState: "Woman left, letter on desk", transition: "Establish next scene" } })) };
    },
    requestVidu: async (endpoint, opts) => { const payload = JSON.parse(opts.body); requests.push({ endpoint, payload }); return { taskId: `mock-${requests.length}`, state: "created", model: payload.model }; },
    normalizeViduTask: t => t,
    getViduTask: async taskId => ({ taskId, state: "success", creations: [{ url: "https://mock.example/media" }] }),
    remoteContent: async (_url, _check, options) => {
      if (options.destination.endsWith(".mp4") && mediaFiles.video) { fs.mkdirSync(path.dirname(options.destination), { recursive: true }); fs.copyFileSync(mediaFiles.video, options.destination); }
      else putImage(options.destination);
    },
    conditionImage: async (input, output) => { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(input, output); },
    sampleFrames: async (_file, dir) => { putImage(path.join(dir, "sample.jpg")); return [{ file: "sample.jpg", time: 1 }]; },
    assemble: async (_clips, output) => { fs.mkdirSync(path.dirname(output), { recursive: true }); mediaFiles.video ? fs.copyFileSync(mediaFiles.video, output) : write(output, "mock-delivery"); return { duration: 64, width: 1440, height: 2560, hasAudio: true }; },
    reviewImageAt: async (_file, output) => putImage(output),
    geminiReview: async () => ({ summary: "Sampled frames show no clear anomaly", uncertain: false, findings: [] }),
  };
  router = createDramaRouter(deps, { root, librarySources: [] });
  return { router, requests, deps };
}
module.exports = { fixture };
