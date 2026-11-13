"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fail } = require("./drama-media");
const { STYLES } = require("./drama-production");
const { MODELS, createVideoClient } = require("./drama-video-models");
const SERVICE_KINDS = ["text", "vidu", "gemini", ...Object.keys(MODELS)];
const AGENTS = {
  analyze: "逐集区分可见事实、字幕和推断，提取开场钩子、冲突升级、反转与结尾悬念。",
  assets: "固定角色身份与参考图对应关系。真人表演自然，对白短促紧凑，画外旁白补充背景与因果，句子在片段内完整结束。",
  video: "根据采样画面检查角色、道具、环境、风格和空间连续性；不把采样质检当成完整音频验收。",
  assemble: "检查成片的非预期风格突变、畸形与多余肢体。只依据可见证据，区分遮挡、多人重叠和真实结构错误，保留问题时间点与证据帧。",
};
function endpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw fail("服务地址格式无效。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail("服务地址只支持 HTTP(S)，不得包含密钥、查询参数或片段。");
  return url.href.replace(/\/+$/, "");
}
function bounded(value, max, label) {
  if (typeof value !== "string" || value.length > max) throw fail(`${label}格式无效或超过 ${max} 字符。`);
  return value.trim();
}
function createSettings(root, deps) {
  const filename = path.join(root, "settings.json");
  let saved = { version: 1, services: {}, styles: {}, agents: { ...AGENTS } };
  if (fs.existsSync(filename)) saved = { ...saved, ...JSON.parse(fs.readFileSync(filename, "utf8")) };
  saved.agents = { ...AGENTS, ...saved.agents };
  const inherited = kind => kind === "text" ? deps.getGatewayConfig?.() || {} : kind === "vidu" ? deps.getViduConfig?.() || {} : kind === "gemini"
    ? { baseUrl: config("text").baseUrl, apiKey: config("text").apiKey, model: "gemini-3.8-flash", enabled: true, intervalSeconds: 2 }
    : { baseUrl: MODELS[kind]?.baseUrl, apiKey: kind === "wan" ? process.env.DASHSCOPE_API_KEY || process.env.WAN_API_KEY || "" : process.env.MINIMAX_KEY || "" };
  const config = kind => ({ ...inherited(kind), ...saved.services[kind] });
  function view() {
    const services = {};
    for (const kind of SERVICE_KINDS) {
      const c = config(kind);
      services[kind] = { baseUrl: c.baseUrl || "", configured: Boolean(c.apiKey), source: saved.services[kind] ? "workspace" : "inherited",
        ...(MODELS[kind] ? { ...MODELS[kind], baseUrl: c.baseUrl, modes: ["t2v", "i2v", "r2v"] } : kind === "text" ? { model: c.model || "", reasoningEffort: c.reasoningEffort || "high", protocol: "responses" }
          : kind === "gemini" ? { model: c.model, enabled: c.enabled, intervalSeconds: c.intervalSeconds, protocol: "responses" }
            : { imageModel: "viduimage-2", referenceModel: "viduq4-preview", videoModel: "viduq4-preview" }) };
    }
    return { version: 1, updatedAt: saved.updatedAt || null, services, agents: saved.agents,
      styles: Object.fromEntries(Object.entries(STYLES).map(([key, value]) => [key, { ...value, supplement: saved.styles[key] || "" }])),
      scope: "当前端口的短剧工作区；风格和 Agent 指令仅写入新建项目，不追改历史项目。",
      storage: { root: path.resolve(root), settingsFile: filename, secrets: "密钥以明文保存在本机设置文件，不返回浏览器，不进入项目导出；请勿共享该文件或整个数据目录。" } };
  }
  function update(body, { active = false, hasMediaTasks = false } = {}) {
    if (active) throw fail("任务运行中不可修改工作区设置，请先等待完成或暂停。", 409);
    const next = structuredClone(saved);
    for (const kind of SERVICE_KINDS) {
      const input = body.services?.[kind];
      if (input === undefined) continue;
      if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("服务配置格式无效。");
      const current = config(kind);
      const baseUrl = endpoint(input.baseUrl ?? current.baseUrl);
      const changedHost = baseUrl !== endpoint(current.baseUrl || baseUrl);
      const key = bounded(input.apiKey ?? "", 1024, "密钥");
      if (/[\r\n\s]/.test(key)) throw fail("密钥不能包含空白字符。");
      if (changedHost && !key) throw fail("修改服务地址时必须重新输入该地址的密钥，不会转发原密钥。");
      // Old task IDs belong to their original endpoint, including completed files later needing recovery.
      if ((kind === "vidu" || MODELS[kind]) && changedHost && hasMediaTasks) throw fail("已有媒体任务绑定当前服务地址，不能切换地址；可在同地址更新密钥。", 409);
      next.services[kind] = { baseUrl, apiKey: key || current.apiKey || "" };
      if (kind === "text") {
        const model = bounded(input.model ?? current.model ?? "", 160, "模型名称");
        if (!model || !/^[a-zA-Z0-9._:/-]+$/.test(model)) throw fail("请填写有效的文本模型 ID。");
        const effort = input.reasoningEffort ?? current.reasoningEffort ?? "high";
        if (!["low", "medium", "high"].includes(effort)) throw fail("推理强度无效。");
        Object.assign(next.services[kind], { model, reasoningEffort: effort });
      }
      if (kind === "gemini") {
        const model = bounded(input.model ?? current.model, 160, "Gemini 模型");
        const enabled = input.enabled ?? current.enabled;
        const intervalSeconds = input.intervalSeconds ?? current.intervalSeconds;
        if (!/^gemini[-a-zA-Z0-9._/]*$/.test(model) || typeof enabled !== "boolean" || ![1, 2, 4].includes(intervalSeconds)) throw fail("Gemini 模型、自动质检开关或采样间隔无效。");
        Object.assign(next.services[kind], { model, enabled, intervalSeconds });
      }
    }
    for (const key of Object.keys(STYLES)) if (body.styles?.[key] !== undefined) next.styles[key] = bounded(body.styles[key], 2000, "风格补充");
    for (const key of Object.keys(AGENTS)) if (body.agents?.[key] !== undefined) next.agents[key] = bounded(body.agents[key], 4000, "Agent 指令");
    next.updatedAt = new Date().toISOString();
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(`${filename}.tmp`, filename); saved = next;
    return view();
  }
  const fetchImpl = deps.settingsFetch || fetch;
  const videoClient = createVideoClient(config, fetchImpl);
  async function requestVidu(route, options) {
    if (!saved.services.vidu) return deps.requestVidu(route, options);
    const c = config("vidu");
    if (!c.apiKey) throw fail("请在设置中心配置 Vidu 密钥。", 503);
    let response;
    try { response = await fetchImpl(`${c.baseUrl}${route}`, { ...options, redirect: "error", signal: AbortSignal.timeout(60000), headers: { Authorization: `Token ${c.apiKey}`, "Content-Type": "application/json" } }); }
    catch { throw fail("Vidu 连接失败；提交结果可能未知，请核对任务后继续。", 502); }
    let data;
    try { data = await response.json(); } catch { throw fail("Vidu 返回了无效 JSON。", 502); }
    if (!response.ok) throw fail(`Vidu 请求失败（HTTP ${response.status}）。请检查账号权限、模型参数或服务配额。`, response.status >= 500 ? 502 : response.status);
    return data;
  }
  async function probe(kind, taskId) {
    if (!SERVICE_KINDS.includes(kind)) throw fail("未知服务类型。");
    const c = config(kind);
    if (!c.apiKey) throw fail("尚未配置密钥。", 400);
    if (MODELS[kind]) {
      if (!taskId) return { ok: null, message: "密钥已配置，尚无历史任务可验证。未发起计费调用，生成权限尚未验证。" };
      const task = await videoClient.poll(kind, taskId);
      return { ok: true, message: `已查询本模型历史任务（${task.state}），未创建新任务。` };
    }
    if (kind === "vidu" && !taskId) return { ok: null, message: "配置已就绪，但没有已知任务 ID 可验证。模型可用性需由实际生成验证；未发起计费调用。" };
    if (kind === "vidu" && !/^[a-zA-Z0-9_-]{1,200}$/.test(taskId)) throw fail("任务 ID 无效。");
    const started = Date.now();
    let response;
    const languageModel = kind === "text" || kind === "gemini";
    try { response = await fetchImpl(`${c.baseUrl}${languageModel ? "/models" : `/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`}`, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: `${languageModel ? "Bearer" : "Token"} ${c.apiKey}` } }); }
    catch { return { ok: false, message: "连接超时、被重定向或网络不可达。请检查服务地址。" }; }
    if (!response.ok) return { ok: false, status: response.status, message: `接口返回 HTTP ${response.status}；未发起生成。` };
    let data;
    try { data = await response.json(); } catch { return { ok: false, message: "服务未返回有效 JSON。" }; }
    if (languageModel) {
      if (!Array.isArray(data.data)) return { ok: false, message: "模型目录格式不兼容；尚未验证 Responses 生成。" };
      const found = data.data.some(m => m.id === c.model);
      return { ok: found, latencyMs: Date.now() - started, message: found ? "鉴权成功，模型目录包含所选模型；生成与视觉能力仍以实际任务为准。" : "鉴权成功，但模型目录未列出所选模型。" };
    }
    return { ok: Boolean(data.task_id || data.id), latencyMs: Date.now() - started, message: "已查询历史任务，未创建新任务。" };
  }
  return { view, update, probe, config,
    creative: () => ({ capturedAt: saved.updatedAt || null, styles: structuredClone(saved.styles), agents: structuredClone(saved.agents) }),
    runtime: { ...deps, getGatewayConfig: () => config("text"), getViduConfig: () => config("vidu"), getGeminiConfig: () => config("gemini"), requestVidu,
      getVideoConfig: config, videoClient,
      getViduTask: taskId => saved.services.vidu ? requestVidu(`/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`, { method: "GET" }).then(data => deps.normalizeViduTask(data)) : deps.getViduTask(taskId),
      requestGatewayResponse: (url, payload, options) => deps.requestGatewayResponse(url, payload, { ...options, fetchImpl: (url, init) => fetchImpl(url, { ...init, redirect: "error" }) }) } };
}
module.exports = { createSettings, AGENTS };
