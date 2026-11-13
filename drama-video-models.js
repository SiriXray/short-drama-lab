"use strict";
const net = require("node:net");
const { fail, publicUrl } = require("./drama-media");

// Contracts supplied with the workspace, dated 2026-10-12. Do not clamp incompatible timings.
const MODELS = {
  wan: { label: "Wan 3.0", model: "wan3.0-video", baseUrl: "https://dashscope.aliyuncs.com/api/v1", minDuration: 2, maxDuration: 30, resolutions: ["480P", "720P", "1080P"], maxReferences: 10 },
  minimax: { label: "MiniMax H3", model: "MiniMax-H3", baseUrl: "https://api.minimaxi.com", minDuration: 4, maxDuration: 15, resolutions: ["2K"], maxReferences: 9 },
};
const RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
function imageUrl(value) {
  if (typeof value !== "string" || value.length > 8000) throw fail("图片链接格式无效。");
  const url = publicUrl(value), host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) || !host.includes(".") || /(?:^|\.)(localhost|local|internal|test)$/.test(host)) throw fail("请提供服务商可访问的公网图片链接，不支持本机文件或内网地址。");
  return url.href;
}
function buildVideoRequest(input) {
  const spec = Object.hasOwn(MODELS, input.provider) && MODELS[input.provider];
  if (!spec) throw fail("未知视频模型。");
  if (!["t2v", "i2v", "r2v"].includes(input.mode)) throw fail("请选择文生、图生或参考生模式。");
  if (!Number.isInteger(input.duration) || input.duration < spec.minDuration || input.duration > spec.maxDuration) throw fail(`${spec.label} 时长必须为 ${spec.minDuration}-${spec.maxDuration} 秒整数；不会自动截短原分镜。`);
  if (!spec.resolutions.includes(input.resolution)) throw fail(`${spec.label} 不支持该清晰度。`);
  if (!RATIOS.includes(input.ratio)) throw fail("画幅比例无效。");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 12000) throw fail("请填写 1-12000 字符的视频提示词。");
  if (!Array.isArray(input.images) || input.images.length > spec.maxReferences) throw fail(`参考图最多 ${spec.maxReferences} 张。`);
  const images = input.images.map(imageUrl);
  if (input.mode === "t2v" && images.length) throw fail("文生视频不应包含图片，请切换模式。");
  if (input.mode === "i2v" && (images.length < 1 || images.length > 2)) throw fail("图生模式需要首帧，可再选一张尾帧。");
  if (input.mode === "r2v" && !images.length) throw fail("参考生模式至少需要一张参考图。");
  let prompt = input.prompt.trim();
  if (input.provider === "wan" && input.mode === "r2v") prompt = `参考图顺序：${images.map((_, i) => `[Image ${i + 1}]`).join("、")}。\n${prompt}`;
  const roles = images.map((url, i) => ({ type: input.mode === "r2v" ? "reference_image" : i === 0 ? "first_frame" : "last_frame", url }));
  if (input.provider === "wan") return { endpoint: "/services/aigc/video-generation/video-synthesis", payload: {
    model: spec.model, input: { prompt, ...(images.length ? { media: roles } : {}) },
    parameters: { duration: input.duration, resolution: input.resolution, ...(input.mode === "i2v" ? {} : { ratio: input.ratio }), watermark: false },
  } };
  return { endpoint: "/v2/video_generation", payload: { model: spec.model,
    content: [{ type: "text", text: prompt }, ...roles.map(r => ({ type: "image_url", image_url: { url: r.url }, role: r.type }))],
    duration: input.duration, resolution: input.resolution, ...(input.mode === "i2v" ? {} : { ratio: input.ratio }),
  } };
}
function taskPath(provider, taskId) {
  if (!Object.hasOwn(MODELS, provider) || !/^[a-zA-Z0-9_-]{1,200}$/.test(taskId)) throw fail("模型或任务 ID 无效。");
  return provider === "wan" ? `/tasks/${taskId}` : `/v2/query/video_generation/${taskId}`;
}
function normalizeTask(provider, data, taskId) {
  const source = provider === "wan" ? data.output : data.task;
  const rawState = String(source?.task_status || source?.status || "").toLowerCase();
  const state = ["succeeded", "success"].includes(rawState) ? "success" : ["failed", "canceled", "cancelled", "expired"].includes(rawState) ? "failed" : rawState === "unknown" ? "unknown" : "processing";
  const url = provider === "wan" ? source?.video_url : source?.content?.url;
  return { taskId: taskId || (provider === "wan" ? data.output?.task_id : data.task_id), model: MODELS[provider].model, state,
    creations: url ? [{ url }] : [], ...(state === "failed" ? { errorCode: "上游任务失败，请在服务商控制台核对原因。" } : {}) };
}
function createVideoClient(config, fetchImpl = fetch) {
  async function request(provider, route, payload, taskId, ownerBaseUrl) {
    const c = config(provider);
    if (!c.apiKey) throw fail(`请先配置 ${MODELS[provider].label} 密钥。`, 503);
    if (ownerBaseUrl && ownerBaseUrl !== c.baseUrl) throw fail("任务绑定的服务地址与当前配置不同，不能跨服务续接。", 409);
    let response, data;
    try {
      response = await fetchImpl(`${c.baseUrl}${route}`, { method: payload ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(payload ? 60000 : 20000),
        headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", ...(payload && provider === "wan" ? { "X-DashScope-Async": "enable" } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}) });
      data = await response.json();
    } catch { throw fail("模型连接失败或响应无效；提交结果可能未知，请核对任务 ID，不要重复生成。", 502); }
    if (!response.ok) throw fail(`模型接口返回 HTTP ${response.status}，请核对参数、权限或额度。`, response.status >= 500 ? 502 : response.status);
    if (data.error || data.code || (data.base_resp?.status_code && Number(data.base_resp.status_code) !== 0)) throw fail("模型接口拒绝请求，请在服务商控制台核对参数、权限或额度。", 422);
    if (taskId && !(provider === "wan" ? data.output?.task_status : data.task?.status)) throw fail("查询响应缺少任务状态，原任务 ID 保留。", 502);
    if (taskId && data.output?.task_id && data.output.task_id !== taskId) throw fail("查询返回的任务 ID 不匹配。", 502);
    return normalizeTask(provider, data, taskId);
  }
  return {
    submit: (provider, endpoint, payload, owner) => request(provider, endpoint, payload, undefined, owner),
    poll: (provider, taskId, owner) => request(provider, taskPath(provider, taskId), undefined, taskId, owner),
  };
}
module.exports = { MODELS, RATIOS, imageUrl, buildVideoRequest, taskPath, normalizeTask, createVideoClient };
