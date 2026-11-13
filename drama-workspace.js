"use strict";

const fs = require("node:fs");
const media = require("./drama-media");
const authored = p => p.sourceKind === "user-script-and-portrait";
const records = p => [...p.assets.map(a => a.image), ...p.episodes.flatMap(e => (e.shots || []).flatMap(s => [s.frame, s.video])), ...(p.modelTrials || []).map(t => t.video)].filter(Boolean);
function exists(store, p, file) { try { return Boolean(file && fs.statSync(store.file(p.id, file)).isFile()); } catch { return false; } }
function state(store, p, record) {
  if (exists(store, p, record?.file)) return "reuse";
  if (["failed", "unknown", "submitting"].includes(record?.state)) return "blocked";
  return record?.taskId ? "resume" : "new";
}
function preflight(p, stage, episodeIds, store) {
  if (!["all", "analyze", "assets", "video", "assemble"].includes(stage)) throw media.fail("未知 Agent 阶段。");
  if (!Array.isArray(episodeIds) || !episodeIds.length || new Set(episodeIds).size !== episodeIds.length || episodeIds.some(id => !p.episodes.some(e => e.id === id))) throw media.fail("请选择有效且不重复的分集。");
  const eps = p.episodes.filter(e => episodeIds.includes(e.id));
  const result = { stage, episodeNumbers: eps.map(e => e.number), images: { new: 0, reuse: 0, resume: 0, blocked: 0 }, videos: { new: 0, reuse: 0, resume: 0, blocked: 0 },
    reference: 0, firstFrame: 0, totalSeconds: 0, unresolvedPlanning: false, warnings: [], blockers: [],
    models: p.production ? `${p.production.referenceModel} / ${p.production.imageModel}` : "viduq4", imageModel: "viduimage-2",
    resolution: p.production?.resolution || "720p", aspectRatio: p.aspectRatio,
    preserveSpeech: p.production?.editPolicy === "complete-generated-clips", authored: authored(p) };
  const count = (bucket, record) => result[bucket][state(store, p, record)]++;
  const used = new Set();
  if (p.job?.status === "running") result.blockers.push("项目正在运行。");
  for (const ep of eps) {
    if ((stage === "all" || stage === "analyze") && !authored(p) && !ep.file && !ep.pageUrl && !ep.videoUrl) result.blockers.push(`第 ${ep.number} 集缺少片源。`);
    if (stage === "analyze" && authored(p)) result.blockers.push("本项目为用户剧本，不具备原片可观察证据，请从分镜与资产阶段继续。");
    const shots = (ep.shots || []).filter(s => s.included !== false);
    if (!shots.length || (p.production && !ep.sourceShots)) result.unresolvedPlanning = true;
    for (const shot of shots) {
      if (!shot.prompt || !(shot.assetIds?.length)) result.unresolvedPlanning = true;
      for (const id of shot.assetIds || []) used.add(id);
      if (p.production && !ep.sourceShots) continue;
      const ref = (shot.mode || p.videoMode) === "reference2video";
      result[ref ? "reference" : "firstFrame"]++;
      result.totalSeconds += p.production?.generationSeconds || Math.max(5, Math.min(16, Math.ceil(shot.end - shot.start)));
      if (["all", "video"].includes(stage)) count("videos", shot.video);
      const needsFrame = !p.production || (!ref && !(p.production.continuity && shot.continuity?.type === "continue"));
      if (["all", "assets"].includes(stage) && needsFrame) count("images", shot.frame);
      if (stage === "video" && !shot.prompt) result.blockers.push(`第 ${ep.number} 集缺少视频提示词。`);
      if (stage === "assemble" && !exists(store, p, shot.video?.file)) result.blockers.push(`第 ${ep.number} 集仍有未保存的视频。`);
    }
    if (stage === "assemble" && !shots.length) result.blockers.push(`第 ${ep.number} 集没有可拼接片段。`);
    if (stage === "video" && (!shots.length || (p.production && !ep.sourceShots))) result.blockers.push(`第 ${ep.number} 集尚未完成分镜规划，请先运行分镜与资产。`);
    if (stage === "assets" && (!shots.length || (!authored(p) && shots.some(s => !s.analysis)))) result.blockers.push(`第 ${ep.number} 集尚未完成拉片。`);
  }
  for (const id of [...used]) {
    const a = p.assets.find(a => a.id === id);
    if (p.production?.continuity && a?.identityMasterId) used.add(a.identityMasterId);
  }
  if (["all", "assets"].includes(stage)) for (const a of p.assets.filter(a => used.has(a.id))) count("images", a.image);
  if (stage === "video") {
    for (const ep of eps) for (const s of (ep.shots || []).filter(s => s.included !== false)) {
      if (state(store, p, s.video) === "reuse") continue;
      const missing = (s.assetIds || []).some(id => !exists(store, p, p.assets.find(a => a.id === id)?.image?.file));
      if (missing || ((s.mode || p.videoMode) !== "reference2video" && s.continuity?.type !== "continue" && !exists(store, p, s.frame?.file))) result.blockers.push("部分镜头缺少资产或首帧，请先运行分镜与资产。");
    }
  }
  if (result.images.blocked || result.videos.blocked) result.blockers.push("存在失败或提交结果未知的任务，请在项目运行记录中核对任务 ID，不能直接重新计费。");
  if (result.unresolvedPlanning) result.warnings.push("分镜或资产规划尚未完成，以下仅统计已确定的任务；后续新增数量和费用尚不确定。");
  if (p.production?.continuity && !p.production.pilotApproved) result.warnings.push("本次先生成每集相邻样片，人工确认句尾与空间衔接后才继续余下镜头。统计包含全量计划。");
  result.blockers = [...new Set(result.blockers)];
  return result;
}
function workspace(store, root, concurrency) {
  const projects = store.list().map(s => store.get(s.id));
  const items = [], tasks = [];
  const add = (p, record, kind, title, description, extra = {}) => {
    if (!exists(store, p, record?.file)) return;
    items.push({ id: `${p.id}:${kind}:${record.id || record.file}`, projectId: p.id, projectTitle: p.title, kind, title, description,
      file: record.file, previewFile: exists(store, p, record.previewFile) ? record.previewFile : record.file, model: record.model || "", sourceUrl: record.creations?.[0]?.url || "", ...extra });
  };
  for (const p of projects) {
    for (const a of p.assets) add(p, a.image, a.type, a.name, a.prompt, { assetId: a.id, identityKey: a.identityKey || "" });
    for (const ep of p.episodes) for (const [i, s] of (ep.shots || []).entries()) {
      const title = `第 ${ep.number} 集 · ${s.title || `镜头 ${i + 1}`}`;
      add(p, s.frame, "frame", title, s.imagePrompt);
      const poster = s.qc?.frames?.[0]?.file || s.frame?.file;
      add(p, s.video, "video", title, s.prompt, { posterFile: exists(store, p, poster) ? poster : "" });
    }
    for (const d of p.deliveries) add(p, d, "delivery", d.title || `第 ${d.number} 集成片`, d.stale ? "历史版本" : "当前成片", { stale: Boolean(d.stale), duration: d.metadata?.duration });
    for (const t of p.modelTrials || []) add(p, t.video, "video", `模型试跑 · ${t.payload.model}`, t.input.prompt, { trialId: t.id });
    const current = new Set(records(p).map(r => r.id));
    for (const r of p.ledger.filter(r => current.has(r.id) && r.state !== "superseded")) tasks.push({ id: r.id, projectId: p.id, projectTitle: p.title,
      taskId: r.taskId, state: r.state, model: r.model, error: r.error || r.lastPollError || "", saved: exists(store, p, r.file), submittedAt: r.submittedAt, credits: r.credits });
  }
  let freeBytes = null;
  try { const s = fs.statfsSync(root); freeBytes = s.bavail * s.bsize; } catch { /* filesystem may not report free space */ }
  return { modelTrials: projects.flatMap(p => (p.modelTrials || []).map(t => ({ id: t.id, projectId: p.id, projectTitle: p.title, input: t.input, createdAt: t.createdAt, video: t.video }))), projects: projects.map(p => ({ id: p.id, title: p.title, episodes: p.episodes.length, job: p.job, updatedAt: p.updatedAt,
    images: items.filter(i => i.projectId === p.id && !["video", "delivery"].includes(i.kind)).length,
    videos: items.filter(i => i.projectId === p.id && i.kind === "video").length,
    deliveries: items.filter(i => i.projectId === p.id && i.kind === "delivery" && !i.stale).length })), items, tasks, concurrency, freeBytes };
}
module.exports = { authored, records, preflight, workspace };
