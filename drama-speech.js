"use strict";

const { randomUUID } = require("node:crypto");
const { STYLES, videoPayload } = require("./drama-production");

function spokenLength(text) {
  return [...text.replace(/[^\p{L}\p{N}]/gu, "")].length;
}

function validateScore(score, shot) {
  if (score.shotId !== shot.id || !score.visual?.trim() || !score.title?.trim()) throw new Error("Speech score must match a shot and contain visual direction and title.");
  if (!Array.isArray(score.lines) || !score.lines.length) throw new Error("Missing speech lines.");
  const duration = shot.end - shot.start;
  const pacing = [];
  let previous = 0, narrationSeconds = 0, dialogueSeconds = 0;
  for (const [index, line] of score.lines.entries()) {
    if (!["narration", "dialogue"].includes(line.kind) || !line.speaker?.trim() || !line.text?.trim()) throw new Error("Invalid speech line.");
    if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < previous || line.end <= line.start || line.end > duration - 0.2) throw new Error("Speech overlaps or exceeds the retained clip timeline.");
    if (line.kind === "narration" && line.speaker !== "画外旁白") throw new Error("Narration must use the off-screen narrator.");
    if (line.kind === "dialogue" && line.speaker === "画外旁白") throw new Error("Narrator cannot be an on-screen dialogue speaker.");
    const seconds = line.end - line.start, cps = spokenLength(line.text) / seconds;
    if (cps < 2.5 || cps > 7) pacing.push({ index, text: line.text, characters: spokenLength(line.text), seconds: +seconds.toFixed(3), cps,
      minCharacters: Math.ceil(seconds * 2.5 - 1e-8), targetMaxCharacters: Math.floor(seconds * 6 + 1e-8), maxCharacters: Math.floor(seconds * 7 + 1e-8) });
    if (line.kind === "narration") narrationSeconds += seconds;
    else dialogueSeconds += seconds;
    previous = line.end;
  }
  if (narrationSeconds < 3) throw new Error("Each revised unit needs at least three seconds of contextual narration.");
  if (pacing.length) {
    const first = pacing[0];
    const error = new Error(`Speech pacing out of range (${first.cps.toFixed(2)} chars/s): ${first.text}（${first.characters}字 / ${first.seconds}秒；本时窗建议不超过${first.targetMaxCharacters}字，硬上限${first.maxCharacters}字）`);
    error.code = "SPEECH_PACING"; error.lines = pacing;
    throw error;
  }
  return { narrationSeconds, dialogueSeconds, duration, words: score.lines.reduce((n, l) => n + spokenLength(l.text), 0) };
}

// Rewrite only over-budget text. Timing, speakers, staging and valid lines remain unchanged.
async function repairSpeechPacing(score, shot, rewrite) {
  let issues;
  try { validateScore(score, shot); return score; }
  catch (error) {
    if (error.code !== "SPEECH_PACING" || error.lines.some(line => line.cps <= 7 || line.targetMaxCharacters < line.minCharacters)) throw error;
    issues = error.lines;
  }
  const result = await rewrite({ visual: score.visual, lines: score.lines, budgets: issues });
  if (!Array.isArray(result?.lines) || result.lines.length !== issues.length || new Set(result.lines.map(l => l?.index)).size !== issues.length) throw new Error("语速修正必须逐条返回超长句的原始 index，不能漏句或重复。");
  const copy = structuredClone(score), changes = [];
  for (const issue of issues) {
    const item = result.lines.find(l => l?.index === issue.index);
    if (typeof item?.text !== "string" || !item.text.trim()) throw new Error("语速修正缺少完整短句。");
    const text = item.text.trim(), count = spokenLength(text);
    if (count < issue.minCharacters || count > issue.targetMaxCharacters) throw new Error(`第 ${issue.index + 1} 句修正后仍超出字数预算：${count} 字，需 ${issue.minCharacters}-${issue.targetMaxCharacters} 字。`);
    copy.lines[issue.index].text = text;
    changes.push({ index: issue.index, originalText: issue.text, text, maxCharacters: issue.targetMaxCharacters });
  }
  validateScore(copy, shot);
  copy.repair = { kind: "speech-text-budget", changes };
  return copy;
}

function compileScore(score, shot, style, context) {
  validateScore(score, shot);
  if (!STYLES[style]) throw new Error("Unknown visual style.");
  // Three-argument callers retain the approved historical episode revision template.
  const setting = context
    ? `时代与地点以当前分镜和参考资产为准，不移植其他剧集的背景或物件。项目背景：${String(context.premise || "以分镜画面为准").slice(0, 900)}。`
    : "七十年代乡村，不新增现代物件。";
  const speakers = new Set(score.lines.filter(l => l.kind === "dialogue").map(l => l.speaker));
  const roster = (context?.identities || []).filter(i => speakers.has(i.key)).map(i => `${i.key}=${i.name}`).join("；");
  const voices = context
    ? `以本项目角色身份和参考形象确定音色，按同一角色代号跨镜头保持，不沿用其他作品的声音设定。${roster ? `说话人对应：${roster}。` : ""}`
    : "浅花衣长辫女子清亮机敏；蓝衣双辫女子明亮爽快；灰衣年长妇人略低沙哑、干脆有压迫感；眼镜青年偏低、克制。";
  return `${STYLES[style].prompt}。竖屏9:16，${setting}沿用参考资产的同一角色、服装、道具与环境。无字幕、水印、logo。
本段是有声短剧改编，不是原声转录。必须实际说出下面引号内台词；角色对白与画外旁白严格按时间表交替，不能省略，不能只做口型。不要把时间、角色标签或制作说明念出。
画外旁白：独立的第三人称成年女声，中低音、清楚利落、${context ? "贴合本项目剧情情绪" : "轻喜剧叙述"}，不属于任何画内人物；不出现旁白人物，不让画内角色为旁白对口型。旁白期间人物继续动作、观察或闭口反应。只补背景与因果，不复述刚说完的台词，不添加画内对白。
角色音色：${voices}换装不换人不换声。角色说话时自然同步口型，另一人听，不两人同时说话。
对白用紧凑自然的普通话短句，约每秒5至6个汉字，不拖字、不唱、不每字停顿，不拉长尾音，不慢动作；句间只留短促换气。时间窗是说完的最后期限，不要为了填满时间故意拉慢；说完即闭口做反应。音效低于人声，不用背景音乐盖住对白。
画面时间轴：${score.visual}
唯一有声脚本（相对本段0秒，全部为本版改编）：
${score.lines.map(l => `${l.start.toFixed(2)}-${l.end.toFixed(2)}秒 | ${l.kind === "narration" ? "画外旁白，画内人物不对口型" : `${l.speaker}对白，同步口型`}：“${l.text}”`).join("\n")}
所有台词在${(shot.end - shot.start - 0.2).toFixed(2)}秒之前说完，其后只保留自然反应和轻环境底声，不在裁切点留下半句话。`;
}

// Clone only one completed episode. Original videos, job and other episodes are never mutated.
function prepareRevision(source, script) {
  const episode = source.episodes.find(e => e.id === script.episodeId);
  if (source.id !== script.sourceProjectId || !source.production || !episode?.sourceShots?.length) throw new Error("Script does not match a production episode.");
  if (episode.shots.some(s => !s.video?.file || s.video.state !== "success")) throw new Error("Original episode must be complete before revision.");
  if (!Array.isArray(script.units) || script.units.length !== episode.shots.length || new Set(script.units.map(s => s.shotId)).size !== episode.shots.length) throw new Error("Script must cover each unit exactly once.");
  const copy = structuredClone(source), ep = structuredClone(episode), now = new Date().toISOString();
  Object.assign(copy, { id: randomUUID(), title: script.title, createdAt: now, updatedAt: now, episodes: [ep], deliveries: [], ledger: [], events: [], job: null, audio: true });
  delete copy.archived;
  copy.revision = { kind: "speech", sourceProjectId: source.id, episodeId: ep.id, createdAt: now, originalDeliveryIds: source.deliveries.filter(d => d.episodeId === ep.id && !d.stale).map(d => d.id), note: script.note };
  const files = new Set([ep.file]);
  for (const s of ep.sourceShots) for (const f of s.frames || []) files.add(f.file);
  for (const s of ep.shots) {
    const score = script.units.find(u => u.shotId === s.id);
    if (!score) throw new Error(`Missing score for ${s.id}`);
    s.speechScore = { ...score, metrics: validateScore(score, s) };
    s.prompt = compileScore(score, s, ep.style); s.title = score.title;
    s.dialogueNote = script.note;
    delete s.video; delete s.qc;
    for (const f of s.frames || []) files.add(f.file);
    if (s.frame?.file) files.add(s.frame.file);
  }
  const used = new Set(ep.shots.flatMap(s => s.assetIds || []));
  copy.assets = copy.assets.filter(a => used.has(a.id));
  ep.assetIds = copy.assets.map(a => a.id);
  for (const a of copy.assets) {
    if (!a.image?.file) throw new Error(`Missing reusable asset: ${a.name}`);
    files.add(a.image.file);
  }
  for (const s of ep.shots) {
    const refs = s.assetIds.map(id => {
      const a = copy.assets.find(a => a.id === id);
      if (!a) throw new Error(`Unknown asset: ${id}`);
      return { name: a.name, image: "validation-only" };
    });
    videoPayload(copy, s, refs, s.frame?.file);
  }
  // Copied images are inherited, not charged again in the revision's ledger.
  copy.events.push({ at: now, message: "第一集旁白与对白节奏修订；复用已有资产和首帧，原版与其他分集保持不变。" });
  return { project: copy, files: [...files].filter(Boolean) };
}

module.exports = { spokenLength, validateScore, repairSpeechPacing, compileScore, prepareRevision };
