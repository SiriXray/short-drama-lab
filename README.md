# short-drama-lab

自托管的 AI 短剧拉片与生产工作台：把一个模糊创意或一部现成短剧，拆成可执行的镜头、关键帧、视频和分集成片。A self-hosted AI workbench that turns a short drama (or a rough idea) into shot-by-shot analysis, keyframes, video clips and episode deliverables.

> 这是从实际内测环境整理出的脱敏发布版：不含任何业务素材、项目数据、密钥或服务器信息。默认只监听 `127.0.0.1`。

## 它能做什么

- **热榜 / 链接导入**：读取公开短剧榜单或剧集页，按公开目录建立项目；不绕过任何访问限制。
- **多帧视觉拉片**：FFmpeg 抽帧 + 视觉模型逐镜头输出场景、动作、环境、运镜、情绪、对白证据与连续性判断。
- **资产与关键帧**：角色母版、场景资产、首帧生成（Vidu Image 2）。
- **图生视频 / 多参考生视频**：Q4 等模型，按镜头生成并回填质检结论。
- **分集交付**：逐集合成、字幕/旁白节奏校验、生产包 ZIP 导出。
- **可中断的长任务**：阶段化执行、暂停/继续、任务幂等与断点恢复，避免重复计费。
- **两种网关协议**：默认 OpenAI Responses（`/v1/responses`）；`ATELIER_PROTOCOL=chat` 时自动转换为 `/chat/completions`，可接 DashScope 兼容模式、DeepSeek 等只支持 Chat Completions 的服务。

## 快速开始

```bash
# 需要 Node.js >= 20.18.1、FFmpeg、FFprobe
npm ci

export ATELIER_API_KEY="<gateway-key>"        # 或 OPENAI_API_KEY / MY_PROXY_API_KEY
export ATELIER_BASE_URL="https://api.openai.com/v1"
export ATELIER_MODEL="gpt-5.6-sol"
export VIDU_API_KEY="<vidu-key>"

npm start            # http://127.0.0.1:4328/drama.html
```

想要“聊天补全”型供应商（例如 DashScope 的 `qwen3-vl-plus`，支持图片与 JSON Schema）：

```bash
export ATELIER_PROTOCOL=chat
export ATELIER_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
export ATELIER_MODEL="qwen3-vl-plus"
export ATELIER_CHAT_MAX_TOKENS=16384
```

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4328` | 监听端口（仅 `127.0.0.1`） |
| `ATELIER_API_KEY` | — | 网关密钥；其次 `MY_PROXY_API_KEY`、`OPENAI_API_KEY` |
| `ATELIER_BASE_URL` | `https://api.openai.com/v1` | 网关地址；其次 `OPENAI_BASE_URL` |
| `ATELIER_MODEL` | `gpt-5.6-sol` | 主模型（需支持图片） |
| `ATELIER_FALLBACK_MODEL` | `gpt-5.6-terra` | 主模型失败后的备用模型 |
| `ATELIER_PROTOCOL` | `responses` | `responses` 或 `chat` |
| `ATELIER_CHAT_MAX_TOKENS` | `16384` | `chat` 模式下单次输出上限 |
| `ATELIER_REASONING_EFFORT` | `low` | 推理强度 |
| `ATELIER_AGENT_MAX_OUTPUT_TOKENS` | `3200` | 创意 Agent 输出上限（上限 5200） |
| `ATELIER_VLM_TIMEOUT_MS` | `480000` | 单次拉片等待时间 |
| `ATELIER_GATEWAY_MAX_ATTEMPTS` | `3` | 网关重试次数 |
| `VIDU_API_KEY` | — | 关键帧与视频模型 |
| `VIDU_BASE_URL` | `https://api.vidu.cn` | Vidu 网关 |
| `FFMPEG_PATH` / `FFPROBE_PATH` | PATH 内查找 | 媒体工具路径 |
| `DRAMA_MAX_PROJECTS` | `4` | 同时运行的项目数（1–8） |
| `DRAMA_LLM_CONCURRENCY` | `2` | LLM 并发（1–8） |
| `DRAMA_IMAGE_CONCURRENCY` | `2` | 图片并发（1–8） |
| `DRAMA_VIDEO_CONCURRENCY` | `3` | 视频并发（1–8） |
| `DRAMA_HLS_CONCURRENCY` | `6` | HLS 分片并行下载数（1–8） |
| `DRAMA_ALLOWED_HOSTS` | — | 反向代理部署时放行的 Host（逗号分隔） |
| `DRAMA_PUBLIC_ORIGINS` | — | 放行的 HTTPS Origin（逗号分隔） |

不设置 `DRAMA_ALLOWED_HOSTS` 时，短剧接口只接受 `127.0.0.1`、`localhost` 的 Host —— 这是有意的本机保护，反代部署时必须显式放行。

## 主要接口

短剧接口在 `/api/drama` 下：`catalog`、`projects`、`projects/:id/episodes`、`run`、`stop`、`recover`、`export`、`health`。
原广告工作台接口保留在 `/api`（`/api/agent/jobs`、`/api/image/create`、`/api/video/analyze` 等）。

## 完整集导入（mp4 / HLS）

平台按“整集”处理，而不是只拉预告片：

- **本地上传**：每集 ≤15 分钟、≤500MB。
- **直链导入**：mp4 / mov / webm，或 HLS（`.m3u8`；支持 master playlist 选码率、AES-128 加密分片）。
- **批量导入**：网页“链接导入”支持每行一个链接，最多 100 条，失败项会逐条回报。
- **预览片守卫**：下载后若时长 <20 秒，默认拒绝并说明“这是预览片”，避免把 10 秒预告当成完整集去拉片；确需导入时勾选“允许导入短于 20 秒的预览片”。
- **安全**：HLS 的播放列表、分片与密钥都逐段经过同一套内网地址校验，不会因为交给 ffmpeg 而绕过 SSRF 防护；分片并行数用 `DRAMA_HLS_CONCURRENCY`（默认 6）调整。

> 红果（hongguoduanju.com）网页端每集只公开约 10 秒、640×360 的预告（`/video/public/<id>/360p.mp4`，实测 10.07 秒）；完整集走 App 内的受保护播放（`/api/video/protected/` + DRM 令牌），不是公开可下载内容。平台不绕过该保护，拉完整集请使用授权本地文件、直链或 HLS。
## 部署

Linux 单机（systemd + nginx + 自签名证书或正式证书）的做法见 [DEPLOY-ECS.md](DEPLOY-ECS.md)，可复用文件在 [`deploy/ecs/`](deploy/ecs/)。

## 测试

```bash
npm test                 # node --test
node --check server.js
```

## 目录

```
server.js              HTTP 入口、静态资源、创意 Agent 与 Vidu 接口
drama-*.js             短剧工作台：路由、引擎、调度、媒体、VLM、生产、设置
gateway-protocol.js    Responses → Chat Completions 兼容层
public/                前端（drama.html 为拉片工作台入口）
test/                  node:test 用例
tools/                 测试夹具与工具
deploy/ecs/            单机部署配置
```

## 说明

- 生成类调用（图片/视频）会真实计费，自动化测试不会提交计费任务。
- 只做视觉拉片时，未提供字幕的音频/对白不作为已验证事实。
- 请自行确认素材授权与各模型服务的条款；本项目不提供绕过平台访问限制的能力。
