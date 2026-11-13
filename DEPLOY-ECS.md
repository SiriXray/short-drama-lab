# 单机部署（Linux · systemd · nginx）

本文说明如何把 short-drama-lab 部署到一台 Linux 云主机，并通过 HTTPS 对外提供小规模访问。下文用 `<your-domain>` 表示域名、`<server-ip>` 表示公网 IP，请替换成自己的值。

## 前置条件

- Node.js **>= 20.18.1**（建议 22 LTS）
- FFmpeg / FFprobe（`ffmpeg -version` 可用）
- nginx、openssl（生成自签名证书或使用正式证书）
- 建议 **2 vCPU / 2 GB 内存 / 20 GB 以上磁盘**；内存紧张时加 2 GB swap
- 一个指向该主机的域名，或使用 `nip.io` 这类通配解析（`<server-ip>.nip.io` 形式）

## 目录布局

```
/opt/short-drama-lab/
  app -> releases/<release-id>   # 原子切换的发布目录
  releases/<release-id>/         # 代码、public、node_modules
/var/lib/short-drama-lab/        # 数据卷（app/data 软链到这里）
/etc/short-drama-lab/app.env     # 运行配置（含密钥，0600）
/etc/short-drama-lab/tls/        # 证书
/etc/nginx/conf.d/short-drama-lab.conf
/etc/systemd/system/short-drama-lab.service
```

## 部署步骤

```bash
# 1. 打包（在开发机上，排除 data、日志、node_modules 之外的大文件）
npm ci
tar -czf short-drama-lab.tar.gz server.js drama-*.js gateway-protocol.js \
    package.json package-lock.json public node_modules

# 2. 上传并执行安装脚本
scp short-drama-lab.tar.gz root@<server-ip>:/tmp/
scp deploy/ecs/*.service deploy/ecs/*.conf* root@<server-ip>:/tmp/
ssh root@<server-ip> "PUBLIC_HOST=<your-domain> bash /tmp/install.sh"
```

脚本会创建服务用户与目录、解包到 `releases/<id>`、切换软链接、写入 systemd 单元与 nginx 站点、生成自签名证书和 Basic Auth 口令（未提供 `BASIC_AUTH_PASSWORD` 时会随机生成并打印一次）。

## 反向代理要点

短剧接口默认只接受 `127.0.0.1` / `localhost` 的 Host，反代必须在 `app.env` 里显式放行：

```bash
DRAMA_ALLOWED_HOSTS=<your-domain>
DRAMA_PUBLIC_ORIGINS=https://<your-domain>
```

nginx 站点建议：

| 指令 | 值 | 原因 |
| --- | --- | --- |
| `client_max_body_size` | `600m` | 单集原片上限 15 分钟 / 500 MB |
| `proxy_request_buffering` | `off` | 上传直接流式写入 Node，不在 nginx 落大临时文件 |
| `proxy_read_timeout` | `1800s` | 视觉模型与视频轮询可能静默数分钟 |
| `proxy_buffering` | `off` | 轮询与下载不缓存 |
| `auth_basic` | 自定义口令文件 | 公网访问至少一层认证 |

完整示例见 [`deploy/ecs/nginx.conf.example`](deploy/ecs/nginx.conf.example)。

## 模型网关

- 默认走 OpenAI Responses 协议：`ATELIER_BASE_URL=https://api.openai.com/v1`、`ATELIER_MODEL=<支持图片的模型>`。
- 若供应商只提供 `/chat/completions`（DashScope 兼容模式、DeepSeek 等），设置 `ATELIER_PROTOCOL=chat`，应用会把内部 Responses 请求转换成 Chat Completions，并把结果标准化回原结构；`ATELIER_CHAT_MAX_TOKENS` 控制单次输出上限。
- 视觉能力是硬性要求：拉片会把抽帧作为图片输入。

## 容量与并发

- `DRAMA_MAX_PROJECTS`、`DRAMA_LLM_CONCURRENCY`、`DRAMA_IMAGE_CONCURRENCY`、`DRAMA_VIDEO_CONCURRENCY` 控制单进程工作队列，适合按机器规格收紧。
- 小规格机器建议 `DRAMA_MAX_PROJECTS=1`，并在 systemd 单元里用 `MemoryHigh` / `MemoryMax` 限制，配合 swap 吸收 FFmpeg 峰值。
- 磁盘按“原片 + 抽帧 + 生成资产”估算，单个 24 集项目约 6–9 GB；导出生产包后及时清理。

## 运维

```bash
systemctl status short-drama-lab --no-pager
journalctl -u short-drama-lab -f
systemctl restart short-drama-lab        # 修改 app.env 后必须重启

curl -s http://127.0.0.1:4328/api/drama/health | python3 -m json.tool
curl -s http://127.0.0.1:4328/api/health | python3 -m json.tool

# 备份数据卷
tar -czf /root/short-drama-lab-data-$(date +%F).tar.gz /var/lib/short-drama-lab
```

## 发布新版本

再次执行安装脚本并指定新的 `RELEASE_ID` 即可：脚本会解包到新的 `releases/<id>`、切换 `app` 软链接并重启服务；`/var/lib/short-drama-lab` 数据不受影响。确认无误后清理旧版本目录。

## 已知限制

- 单机单实例，没有多副本与负载均衡，适合小规模内测。
- 自签名证书需要浏览器手动信任；正式对外请换 Let's Encrypt 或商业证书。
- `ATELIER_PROTOCOL` 是进程级开关：同一实例内所有模型请求使用同一种协议。
- 图片/视频生成会真实计费。
