const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildFrameTimes,
  buildCreativePromptPayload,
  buildGatewayPayload,
  buildViduImagePayload,
  buildViduPayload,
  buildVideoAnalysisPayload,
  CREATIVE_STYLE_PRESETS,
  extractOutputText,
  callGateway,
  cleanupAgentJobs,
  createAgentJob,
  createServer,
  fetchRemoteImage,
  gatewayModelCandidates,
  isPrivateAddress,
  normalizeAgentRequest,
  normalizeCreativePromptRequest,
  normalizeRemoteImageUrl,
  normalizeRemoteVideoUrl,
  normalizeViduCreateRequest,
  normalizeViduImageCreateRequest,
  normalizeViduTask,
  parseSceneTimestamps,
  parseModelJson,
  publicErrorPayload,
  probeGateway,
  requestGatewayResponse,
  validateViduImageBuffer,
  validateAgentResult,
  validateCreativePromptResult,
  validateVideoAnalysisResult,
} = require("../server");

const VALID_IMAGE_DATA_URL = `data:image/webp;base64,${fs.readFileSync(path.join(__dirname, "..", "public", "assets", "red-device.webp")).toString("base64")}`;

function validAgentResult(agentIds = ["strategist", "prompt", "director", "evaluator"]) {
  return {
    caseTitle: "测试产品短片",
    intentSummary: "把产品卖点转化为清晰的短视频叙事。",
    creativeStrategy: "用一次明确的产品动作建立记忆点，并在结尾完成品牌收束。",
    sourceAnalysis: {
      subject: "人物与产品",
      scene: "明亮摄影棚",
      style: "克制的商业广告",
      composition: "人物居中，产品位于视觉焦点",
      opportunities: ["产品颜色醒目", "人物动作可形成叙事"],
      risks: ["需保持产品结构一致"],
    },
    agents: agentIds.map((id) => ({
      id,
      headline: `${id} 方案`,
      output: `${id} 已输出可执行方案。`,
      bullets: ["保持主体一致", "强化产品卖点"],
    })),
    production: {
      format: "社交媒体产品广告",
      audience: "潜在产品用户",
      duration: "8 秒",
      aspectRatio: "9:16",
      imagePrompt: "商业人物产品摄影，主体清晰",
      videoPrompt: "人物抬起产品，镜头缓慢推进",
      negativePrompt: "结构变化，文字，水印",
      storyboard: [
        { shot: "S01", time: "0-2s", visual: "人物展示产品", camera: "中景", audio: "节拍进入", prompt: "中景展示产品" },
        { shot: "S02", time: "2-6s", visual: "人物抬起产品", camera: "缓慢推近", audio: "高光音效", prompt: "镜头推近产品" },
        { shot: "S03", time: "6-8s", visual: "人物定格", camera: "近景停住", audio: "品牌收束", prompt: "近景定格" },
      ],
    },
    nextActions: ["生成关键帧", "执行多模型对比"],
    tags: ["产品", "人物", "商业广告"],
  };
}

test("normalizeAgentRequest accepts a brief and normalizes product controls", () => {
  const result = normalizeAgentRequest({
    brief: "做一个高级时尚产品短片",
    mode: "storyboard",
    agents: ["director", "director", "prompt", "unknown"],
    duration: 15,
    aspectRatio: "16:9",
  });
  assert.equal(result.mode, "storyboard");
  assert.deepEqual(result.agents, ["director", "prompt"]);
  assert.equal(result.duration, 15);
  assert.equal(result.aspectRatio, "16:9");
});

test("normalizeAgentRequest preserves the production UI 12-second option", () => {
  assert.equal(normalizeAgentRequest({ brief: "十二秒产品短片", duration: 12 }).duration, 12);
});

test("normalizeAgentRequest accepts a creative style preset and falls back safely", () => {
  assert.equal(normalizeAgentRequest({ brief: "极简手机广告", styleId: "apple" }).styleId, "apple");
  assert.equal(normalizeAgentRequest({ brief: "复古时装广告", styleId: "unknown-style" }).styleId, "auto");
  assert.equal(CREATIVE_STYLE_PRESETS.miumiu.label, "Miu Miu 复古少女");
});

test("normalizeAgentRequest accepts image-only input", () => {
  const result = normalizeAgentRequest({ imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" });
  assert.equal(result.brief, "");
  assert.equal(result.agents.length, 4);
});

test("normalizeAgentRequest accepts and deduplicates a reference image group", () => {
  const primary = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  const secondary = "data:image/png;base64,iVBORw0KGgo=";
  const result = normalizeAgentRequest({ imageDataUrls: [primary, secondary, primary] });
  assert.equal(result.imageDataUrl, "");
  assert.deepEqual(result.imageDataUrls, [primary, secondary]);
});

test("normalizeAgentRequest rejects an empty request", () => {
  assert.throws(() => normalizeAgentRequest({}), /创意描述或参考图片/);
});

test("gateway payload includes selected agents, image and structured schema", () => {
  const input = normalizeAgentRequest({
    brief: "人物走入雨夜",
    imageDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    agents: ["strategist", "director"],
  });
  const payload = buildGatewayPayload(input, "gpt-5.6-sol", true, "medium");
  assert.equal(payload.model, "gpt-5.6-sol");
  assert.equal(payload.input[0].content[1].type, "input_image");
  assert.equal(payload.text.format.name, "atelier_agent_case");
  assert.equal(payload.max_output_tokens, 3200);
  assert.match(payload.input[0].content[0].text, /创意策略 Agent/);
});

test("gateway payload applies the selected creative direction to Agent instructions", () => {
  const input = normalizeAgentRequest({
    brief: "做一支人物时装广告",
    styleId: "miumiu",
    agents: ["strategist", "prompt", "director", "evaluator"],
  });
  const payload = buildGatewayPayload(input, "gpt-5.6-sol", true, "low");
  const userBrief = payload.input[0].content[0].text;
  assert.match(userBrief, /创意方向：Miu Miu 复古少女/);
  assert.match(userBrief, /复古学院与当代少女感/);
  assert.match(payload.instructions, /必须把用户选择的创意方向落实到/);
  assert.match(userBrief, /不要复制品牌 Logo/);
});

test("gateway payload sends the primary reference in high detail and supplemental references in low detail", () => {
  const input = normalizeAgentRequest({
    brief: "综合多张参考图",
    imageDataUrls: [
      "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      "data:image/png;base64,iVBORw0KGgo=",
    ],
  });
  const payload = buildGatewayPayload(input, "gpt-5.6-sol", true, "medium");
  const images = payload.input[0].content.filter((item) => item.type === "input_image");
  assert.equal(images.length, 2);
  assert.equal(images[0].detail, "high");
  assert.equal(images[1].detail, "low");
});

test("creative prompt payload is compact and supports optional image understanding", () => {
  const input = normalizeCreativePromptRequest({
    brief: "让产品在晨光里缓慢旋转",
    imageDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    aspectRatio: "16:9",
    duration: 5,
  });
  const payload = buildCreativePromptPayload(input, "gpt-5.5", true);
  assert.equal(payload.max_output_tokens, 1400);
  assert.equal(payload.reasoning.effort, "low");
  assert.equal(payload.input[0].content[1].detail, "low");
  assert.equal(payload.text.format.name, "creative_video_prompt");
});

test("creative prompt payload includes every reference image at low detail", () => {
  const input = normalizeCreativePromptRequest({
    brief: "综合两张参考图",
    imageDataUrls: [
      "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      "data:image/png;base64,iVBORw0KGgo=",
    ],
  });
  const payload = buildCreativePromptPayload(input, "gpt-5.6-sol", true);
  const images = payload.input[0].content.filter((item) => item.type === "input_image");
  assert.equal(images.length, 2);
  assert.ok(images.every((image) => image.detail === "low"));
});

test("creative prompt result keeps only the production fields the idea flow needs", () => {
  const result = validateCreativePromptResult({
    visualSummary: "产品位于玻璃展台中央",
    imagePrompt: "商业产品摄影",
    videoPrompt: "产品缓慢旋转，镜头推近",
    negativePrompt: "结构变化，文字，水印",
    motionPlan: [
      { time: "0-1s", action: "保持静止", camera: "中景" },
      { time: "1-3s", action: "缓慢旋转", camera: "推近" },
      { time: "3-5s", action: "高光扫过", camera: "近景停住" },
    ],
  });
  assert.equal(result.videoPrompt, "产品缓慢旋转，镜头推近");
  assert.equal(result.motionPlan.length, 3);
});

test("extractOutputText supports Responses API output arrays", () => {
  assert.equal(extractOutputText({ output: [{ content: [{ text: "{\"ok\":true}" }] }] }), "{\"ok\":true}");
});

test("parseModelJson strips markdown fences", () => {
  assert.deepEqual(parseModelJson("```json\n{\"ok\":true}\n```"), { ok: true });
});

test("validateAgentResult filters agents to requested roles", () => {
  const result = validateAgentResult(validAgentResult(["director", "evaluator"]), { agents: ["director"] });
  assert.deepEqual(result.agents.map((agent) => agent.id), ["director"]);
});

test("validateAgentResult rejects a visually unusable partial production", () => {
  const partial = validAgentResult(["director"]);
  partial.production.storyboard = [];
  assert.throws(() => validateAgentResult(partial, { agents: ["director"] }), /不完整/);
});

test("validated production prompts carry the selected style into every generation surface", () => {
  const result = validateAgentResult(validAgentResult(), {
    agents: ["strategist", "prompt", "director", "evaluator"],
    styleId: "apple",
  });
  assert.match(result.production.imagePrompt, /极简科技产品广告/);
  assert.match(result.production.videoPrompt, /极简科技产品广告/);
  assert.ok(result.production.storyboard.every((shot) => /极简科技产品广告/.test(shot.prompt)));
  assert.match(result.production.negativePrompt, /避免堆叠道具/);
  assert.equal(result.creativeStyle.id, "apple");
});

test("remote URL validation rejects unsafe schemes and credentials", () => {
  assert.equal(normalizeRemoteImageUrl("https://example.com/a.png#x").href, "https://example.com/a.png");
  assert.throws(() => normalizeRemoteImageUrl("file:///C:/a.png"), /HTTP/);
  assert.throws(() => normalizeRemoteImageUrl("https://user:pass@example.com/a.png"), /账号或密码/);
});

test("private network detection covers IPv4 and IPv6", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("192.168.2.10"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("fetchRemoteImage uses response MIME instead of URL suffix", async () => {
  const bytes = new Uint8Array([82, 73, 70, 70]);
  const result = await fetchRemoteImage("https://images.example.test/a.png", {
    lookup: async () => [{ address: "203.0.113.10" }],
    fetchImpl: async () => new Response(bytes, { status: 200, headers: { "content-type": "image/webp" } }),
  });
  assert.equal(result.contentType, "image/webp");
  assert.deepEqual(result.buffer, Buffer.from(bytes));
});

test("Q4 payload includes audio and accepts the live Q4 duration range", () => {
  const input = normalizeViduCreateRequest({
    model: "viduq4",
    imageDataUrl: VALID_IMAGE_DATA_URL,
    prompt: "镜头缓慢推近",
    duration: 5,
    resolution: "1080p",
    audio: true,
    offPeak: true,
  });
  const payload = buildViduPayload(input);
  assert.equal(payload.model, "viduq4");
  assert.equal(payload.audio, true);
  assert.equal(payload.off_peak, false, "音画同出时必须关闭错峰");
  assert.equal(payload.duration, 5);
});

test("Q3.1-ad payload omits the Q4-only audio field", () => {
  const input = normalizeViduCreateRequest({
    model: "viduq3.1-ad",
    imageDataUrl: VALID_IMAGE_DATA_URL,
    prompt: "人物转身，镜头跟随",
    duration: 4,
    resolution: "2K",
    audio: true,
    offPeak: true,
  });
  const payload = buildViduPayload(input);
  assert.equal(payload.model, "viduq3.1-ad");
  assert.equal(payload.off_peak, true);
  assert.equal(Object.hasOwn(payload, "audio"), false);
});

test("Vidu model-specific bounds and formats are validated", () => {
  const imageDataUrl = VALID_IMAGE_DATA_URL;
  assert.throws(() => normalizeViduCreateRequest({ model: "viduq3.1-ad", imageDataUrl, duration: 3 }), /4-15/);
  assert.throws(() => normalizeViduCreateRequest({ model: "viduq4", imageDataUrl, duration: 4 }), /5-16/);
  assert.throws(() => normalizeViduCreateRequest({ model: "viduq4", imageDataUrl, duration: 17 }), /5-16/);
  assert.throws(() => normalizeViduCreateRequest({ model: "other", imageDataUrl, duration: 5 }), /仅支持/);
  assert.throws(() => normalizeViduCreateRequest({ model: "viduq4", imageDataUrl: "data:image/gif;base64,R0lG", duration: 5 }), /PNG、JPG 或 WebP/);
});

test("Vidu image dimensions reject images below the documented minimum", () => {
  const pngHeader = Buffer.alloc(24);
  pngHeader.write("PNG", 1, "ascii");
  pngHeader.writeUInt32BE(128, 16);
  pngHeader.writeUInt32BE(128, 20);
  assert.throws(() => validateViduImageBuffer(pngHeader, "png"), /256–5760/);
});

test("Vidu task responses are normalized for frontend polling", () => {
  assert.deepEqual(normalizeViduTask({
    id: "task-1",
    state: "success",
    credits: 12,
    creations: [{ id: "creation-1", url: "https://cdn.test/a.mp4", cover_url: "https://cdn.test/a.jpg" }],
  }), {
    taskId: "task-1",
    state: "success",
    model: null,
    credits: 12,
    errorCode: null,
    creations: [{ id: "creation-1", url: "https://cdn.test/a.mp4", coverUrl: "https://cdn.test/a.jpg", watermarkedUrl: null }],
    createdAt: null,
  });
});

test("Vidu image payload follows the documented text-to-image contract", () => {
  const input = normalizeViduImageCreateRequest({
    prompt: "雨夜街头的透明香水瓶，电影灯光",
    aspectRatio: "16:9",
    resolution: "2K",
    quality: "medium",
  });
  assert.deepEqual(buildViduImagePayload(input), {
    model: "viduimage-2",
    images: [],
    prompt: "雨夜街头的透明香水瓶，电影灯光",
    aspect_ratio: "16:9",
    resolution: "2K",
    quality: "medium",
  });
});

test("Vidu image controls reject unsupported model options", () => {
  assert.throws(() => normalizeViduImageCreateRequest({ prompt: "test", aspectRatio: "7:5" }), /不支持该图片比例/);
  assert.throws(() => normalizeViduImageCreateRequest({ prompt: "test", resolution: "512" }), /仅支持 1K、2K 或 4K/);
  assert.throws(() => normalizeViduImageCreateRequest({ prompt: "test", resolution: "8K" }), /仅支持 1K、2K 或 4K/);
  assert.throws(() => normalizeViduImageCreateRequest({ prompt: "test", quality: "ultra" }), /质量仅支持/);
  assert.throws(() => normalizeViduImageCreateRequest({ prompt: "" }), /描述要生成的关键帧/);
});

test("video scene timestamps and adaptive frame times are deterministic", () => {
  assert.deepEqual(parseSceneTimestamps("pts_time:1.25\npts_time:4.5\npts_time:4.5", 5), [1.25, 4.5]);
  const times = buildFrameTimes(15, [2.25, 8.75]);
  assert.equal(times[0], 0);
  assert.ok(times.includes(2.25));
  assert.ok(times.includes(8.75));
  assert.ok(times.length <= 18);
});

test("video analysis payload carries timestamped images and strict schema", () => {
  const payload = buildVideoAnalysisPayload({
    metadata: { durationLabel: "00:05.0", width: 1080, height: 1920, aspectRatio: "1080:1920", codec: "h264", hasAudio: true },
    sceneTimes: [2],
    audioSignals: { hasAudio: true },
    focus: "产品露出",
  }, "gpt-5.6-sol", [{ index: 1, timeLabel: "00:00.0", path: __filename }], true, "medium");
  assert.equal(payload.text.format.name, "advert_video_teardown");
  assert.equal(payload.input[0].content[1].text, "帧 1 · 00:00.0");
  assert.equal(payload.input[0].content[2].type, "input_image");
  assert.equal(payload.max_output_tokens, 2400);
  assert.deepEqual(payload.text.format.schema.properties.shots.items.required, [
    "start", "end", "frameIndex", "visual", "camera", "action", "audioText", "role", "prompt",
  ]);
});

test("compact video analysis expands to the frontend report contract", () => {
  const result = validateVideoAnalysisResult({
    title: "测试广告",
    summary: "摘要",
    adStructure: { hook: "开场", problem: "冲突", productProof: "证明", payoff: "回报", cta: "收束" },
    shots: [{
      start: 0,
      end: 3.25,
      frameIndex: 1,
      visual: "人物拿起产品",
      camera: "中景，缓慢推近",
      action: "人物看向镜头",
      audioText: "旁白与品牌字幕",
      role: "建立产品认知并完成钩子",
      prompt: "中景人物产品广告，缓慢推近",
    }],
    visualSystem: ["高反差"],
    audioSystem: ["节奏音乐"],
    rhythm: "先快后慢",
    replicationPlan: ["准备产品"],
    masterPrompt: "主提示词",
    negativePrompt: "负面提示词",
    risks: ["文字可能不清"],
  }, { duration: 10 });
  assert.deepEqual(result.shots[0], {
    start: 0,
    end: 3.25,
    frameIndex: 1,
    visual: "人物拿起产品",
    camera: "中景，缓慢推近",
    action: "人物看向镜头",
    audioText: "旁白与品牌字幕",
    role: "建立产品认知并完成钩子",
    prompt: "中景人物产品广告，缓慢推近",
    id: "S01",
    duration: 3.25,
    shotSize: "中景，缓慢推近",
    movement: "中景，缓慢推近",
    onScreenText: "旁白与品牌字幕",
    audio: "旁白与品牌字幕",
    productRole: "建立产品认知并完成钩子",
    transition: "开场",
    whyItWorks: "建立产品认知并完成钩子",
  });
});

test("remote video URL validation rejects local and non-HTTP schemes", () => {
  assert.equal(normalizeRemoteVideoUrl("https://cdn.example.com/ad.mp4#preview").href, "https://cdn.example.com/ad.mp4");
  assert.throws(() => normalizeRemoteVideoUrl("file:///C:/ad.mp4"), /HTTP/);
});

test("gateway requests retry transient network failures and retain a trace id", async () => {
  let calls = 0;
  const result = await requestGatewayResponse("https://gateway.test/responses", { model: "test" }, {
    headers: { Authorization: "Bearer test" },
    maxAttempts: 3,
    timeoutMs: 1000,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
      return new Response(JSON.stringify({ id: "response-1" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
  assert.match(result.traceId, /^[a-f0-9]{12}$/);
});

test("gateway requests do not retry non-transient client errors", async () => {
  let calls = 0;
  await assert.rejects(() => requestGatewayResponse("https://gateway.test/responses", {}, {
    headers: {},
    maxAttempts: 3,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    },
  }), (error) => error.statusCode === 400 && error.errorCode === "GATEWAY_HTTP_400");
  assert.equal(calls, 1);
});

test("gateway requests stop immediately when the Agent deadline is cancelled", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = requestGatewayResponse("https://gateway.test/responses", {}, {
    headers: {},
    maxAttempts: 3,
    timeoutMs: 1000,
    signal: controller.signal,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      calls += 1;
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    },
  });
  controller.abort(new DOMException("cancelled", "AbortError"));
  await assert.rejects(() => pending, (error) => error.name === "AbortError" && error.retryable === false);
  assert.equal(calls, 1);
});

test("callGateway returns genuine complete Agent output from the Responses API", async () => {
  const input = normalizeAgentRequest({ brief: "制作 8 秒产品广告", agents: ["strategist", "director"] });
  let calls = 0;
  const output = await callGateway(input, {
    config: {
      apiKey: "test-key",
      baseUrl: "https://gateway.test/v1",
      model: "gpt-5.6-sol",
      fallbackModel: "gpt-5.6-terra",
      reasoningEffort: "low",
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        id: "response-full-agent",
        status: "completed",
        output: [{ content: [{ text: JSON.stringify(validAgentResult(["strategist", "director"])) }] }],
      }), { status: 200, headers: { "x-request-id": "gateway-request-1" } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(output.result.agents.length, 2);
  assert.equal(output.result.production.storyboard.length, 3);
  assert.equal(output.model, "gpt-5.6-sol");
});

test("Agent jobs are idempotent and polling does not run a second billed call", async () => {
  const store = new Map();
  const input = normalizeAgentRequest({ brief: "制作产品广告", agents: ["director"] });
  let calls = 0;
  const runAgent = async () => {
    calls += 1;
    return { result: validAgentResult(["director"]), model: "gpt-5.6-sol", fallbackUsed: false };
  };
  const first = createAgentJob(input, { store, runAgent, clientRequestId: "request_12345678" });
  await first.job.promise;
  const second = createAgentJob(input, { store, runAgent, clientRequestId: "request_12345678" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.job.jobId, first.job.jobId);
  assert.equal(second.job.status, "succeeded");
  assert.equal(calls, 1);
});

test("Agent job API accepts quickly and exposes the completed result through GET", async (t) => {
  const store = new Map();
  let calls = 0;
  const server = createServer({
    agentJobs: store,
    runAgent: async () => {
      calls += 1;
      return { result: validAgentResult(["director"]), model: "gpt-5.6-sol", fallbackUsed: false };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const createResponse = await fetch(`http://127.0.0.1:${port}/api/agent/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief: "制作产品广告", agents: ["director"], clientRequestId: "request_api_12345678" }),
  });
  assert.equal(createResponse.status, 202);
  const created = await createResponse.json();
  await store.get(created.jobId).promise;
  const statusResponse = await fetch(`http://127.0.0.1:${port}/api/agent/jobs/${created.jobId}`);
  const status = await statusResponse.json();
  assert.equal(status.status, "succeeded");
  assert.equal(status.result.caseTitle, "测试产品短片");
  assert.equal(calls, 1);
});

test("expired finished Agent jobs are removed while active jobs are retained", () => {
  const store = new Map([
    ["old", { jobId: "old", status: "succeeded", finishedAtMs: 1000 }],
    ["active", { jobId: "active", status: "running", finishedAtMs: null }],
  ]);
  cleanupAgentJobs(store, 1000 + 31 * 60 * 1000);
  assert.equal(store.has("old"), false);
  assert.equal(store.has("active"), true);
});

test("public gateway errors expose diagnostics without internal objects", () => {
  assert.deepEqual(publicErrorPayload(Object.assign(new Error("连接失败"), {
    errorCode: "ECONNRESET",
    traceId: "abc123",
    retryable: true,
  }), "fallback"), {
    error: "连接失败",
    errorCode: "ECONNRESET",
    traceId: "abc123",
    retryable: true,
  });
});

test("gateway health probe separates network reachability from authentication", async () => {
  const result = await probeGateway({ apiKey: "test", baseUrl: "https://gateway.test/v1" }, {
    force: true,
    fetchImpl: async () => new Response("unauthorized", { status: 401 }),
  });
  assert.equal(result.reachable, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.statusCode, 401);
  assert.ok(result.latencyMs >= 0);
});

test("gateway health probe accepts an authenticated HTTP response", async () => {
  const result = await probeGateway({ apiKey: "test", baseUrl: "https://gateway.test/v1" }, {
    force: true,
    fetchImpl: async () => new Response("ok", { status: 200 }),
  });
  assert.equal(result.reachable, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.statusCode, 200);
});


test("gateway model candidates preserve primary then fallback order", () => {
  assert.deepEqual(gatewayModelCandidates({ model: "gpt-5.6-sol", fallbackModel: "gpt-5.5" }, 0), ["gpt-5.6-sol", "gpt-5.5"]);
  assert.deepEqual(gatewayModelCandidates({ model: "gpt-5.5", fallbackModel: "gpt-5.5" }, 0), ["gpt-5.5"]);
});
