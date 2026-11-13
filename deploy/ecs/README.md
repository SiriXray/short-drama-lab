# deploy/ecs

单机部署模板，配合 [`../../DEPLOY-ECS.md`](../../DEPLOY-ECS.md) 使用。

| 文件 | 用途 |
| --- | --- |
| `install.sh` | 创建用户与目录、解包发布、写入 systemd/nginx、生成 TLS 与 Basic Auth、启动服务 |
| `app.env.example` | 运行配置模板（密钥、模型、并发、反代放行） |
| `short-drama-lab.service` | systemd 单元模板（`__NODE_BIN__` 由脚本替换） |
| `nginx.conf.example` | nginx 站点模板（`__PUBLIC_HOST__` 由脚本替换） |

## 用法

```bash
# 开发机：打包
npm ci
tar -czf short-drama-lab.tar.gz server.js drama-*.js gateway-protocol.js \
    package.json package-lock.json public node_modules
scp short-drama-lab.tar.gz root@<server-ip>:/tmp/
scp deploy/ecs/short-drama-lab.service deploy/ecs/nginx.conf.example \
    deploy/ecs/app.env.example deploy/ecs/install.sh root@<server-ip>:/tmp/

# 服务器：安装或升级
ssh root@<server-ip> "PUBLIC_HOST=lab.example.com bash /tmp/install.sh"
```

- 首次安装后编辑 `/etc/short-drama-lab/app.env` 填入 `ATELIER_API_KEY`、`VIDU_API_KEY` 等，再 `systemctl restart short-drama-lab`。
- 升级时重复执行即可，`RELEASE_ID` 会自动生成新目录并切换软链接，数据卷不受影响。
- 脚本默认走 `bash`，需要 root、nginx、openssl、Node >= 20.18.1。
