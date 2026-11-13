#!/usr/bin/env bash
# 单机安装 / 升级 short-drama-lab：目录、发布包、systemd、nginx、TLS、Basic Auth。
#
# 用法（需要 root）：
#   PUBLIC_HOST=lab.example.com \
#   BASIC_AUTH_USER=lab BASIC_AUTH_PASSWORD='...' \
#   bash install.sh
#
# 可选环境变量：
#   TARBALL        发布包路径，默认 /tmp/short-drama-lab.tar.gz
#   UNIT_SRC       systemd 单元模板，默认 /tmp/short-drama-lab.service
#   NGINX_SRC      nginx 站点模板，默认 /tmp/nginx.conf.example
#   ENV_SRC        环境变量模板，默认 /tmp/app.env.example
#   RELEASE_ID     发布标识，默认当前时间戳
#   NODE_BIN       node 可执行文件，默认从 PATH 查找
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/short-drama-lab}"
DATA_ROOT="${DATA_ROOT:-/var/lib/short-drama-lab}"
ETC="${ETC:-/etc/short-drama-lab}"
SERVICE_NAME="short-drama-lab"
SERVICE_USER="${SERVICE_USER:-shortdrama}"
PUBLIC_HOST="${PUBLIC_HOST:?请设置 PUBLIC_HOST，例如 lab.example.com}"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d-%H%M%S)}"
TARBALL="${TARBALL:-/tmp/short-drama-lab.tar.gz}"
UNIT_SRC="${UNIT_SRC:-/tmp/short-drama-lab.service}"
NGINX_SRC="${NGINX_SRC:-/tmp/nginx.conf.example}"
ENV_SRC="${ENV_SRC:-/tmp/app.env.example}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-lab}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

[ "$(id -u)" = "0" ] || { echo "请以 root 运行。" >&2; exit 1; }
[ -x "$NODE_BIN" ] || { echo "找不到 node，请用 NODE_BIN 指定可执行文件。" >&2; exit 1; }
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<20||(a===20&&b<18)){console.error("需要 Node >= 20.18.1，当前 "+process.versions.node);process.exit(1)}'
command -v ffmpeg >/dev/null || echo "警告：未在 PATH 找到 ffmpeg，请确认 app.env 里的 FFMPEG_PATH。"
[ -f "$TARBALL" ] || { echo "找不到发布包：$TARBALL" >&2; exit 1; }
[ -f "$UNIT_SRC" ] && [ -f "$NGINX_SRC" ] || { echo "缺少 systemd / nginx 模板。" >&2; exit 1; }

RELEASE_DIR="$APP_ROOT/releases/$RELEASE_ID"

echo "== 用户与目录 =="
id "$SERVICE_USER" >/dev/null 2>&1 || useradd -r -M -d "$DATA_ROOT" -s /sbin/nologin "$SERVICE_USER"
install -d -m 755 "$APP_ROOT" "$APP_ROOT/releases" "$ETC" "$ETC/tls"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$DATA_ROOT"

echo "== 解包 $RELEASE_ID =="
rm -rf "$RELEASE_DIR"
install -d "$RELEASE_DIR"
tar -xzf "$TARBALL" -C "$RELEASE_DIR"
ln -sfn "$DATA_ROOT" "$RELEASE_DIR/data"
chown -R root:root "$RELEASE_DIR"
chmod -R a+rX "$RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$APP_ROOT/app"
readlink -f "$APP_ROOT/app"

echo "== 配置 =="
if [ -f "$ENV_SRC" ] && [ ! -f "$ETC/app.env" ]; then
  install -m 600 -o root -g root "$ENV_SRC" "$ETC/app.env"
  echo "已写入 $ETC/app.env —— 请填入密钥与 DRAMA_ALLOWED_HOSTS 后再重启。"
else
  echo "保留已有 $ETC/app.env"
fi
# 反代放行：只补齐缺失的 Host / Origin（已有配置不动）
if ! grep -q '^DRAMA_ALLOWED_HOSTS=' "$ETC/app.env" 2>/dev/null; then
  printf 'DRAMA_ALLOWED_HOSTS=%s\nDRAMA_PUBLIC_ORIGINS=https://%s\n' "$PUBLIC_HOST" "$PUBLIC_HOST" >> "$ETC/app.env"
fi

sed "s|__NODE_BIN__|$NODE_BIN|g" "$UNIT_SRC" > "/etc/systemd/system/$SERVICE_NAME.service"
chmod 644 "/etc/systemd/system/$SERVICE_NAME.service"

echo "== TLS =="
if [ ! -s "$ETC/tls/server.crt" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$ETC/tls/server.key" -out "$ETC/tls/server.crt" \
    -subj "/CN=$PUBLIC_HOST" -addext "subjectAltName=DNS:$PUBLIC_HOST" >/dev/null 2>&1
fi
chmod 600 "$ETC/tls/server.key"
chmod 644 "$ETC/tls/server.crt"

echo "== Basic Auth =="
BASIC_AUTH_PASSWORD="${BASIC_AUTH_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)}"
printf '%s:%s\n' "$BASIC_AUTH_USER" "$(openssl passwd -apr1 "$BASIC_AUTH_PASSWORD")" > /etc/nginx/short-drama-lab.htpasswd
chown root:nginx /etc/nginx/short-drama-lab.htpasswd 2>/dev/null || true
chmod 640 /etc/nginx/short-drama-lab.htpasswd

echo "== nginx =="
sed "s|__PUBLIC_HOST__|$PUBLIC_HOST|g" "$NGINX_SRC" > /etc/nginx/conf.d/short-drama-lab.conf
nginx -t
systemctl reload nginx

echo "== 服务 =="
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl is-active "$SERVICE_NAME"

cat <<EOF

完成。
  访问：https://$PUBLIC_HOST/drama.html
  用户：$BASIC_AUTH_USER
  口令：$BASIC_AUTH_PASSWORD   （仅本次输出，请立即保存）
  配置：$ETC/app.env           （填好密钥后 systemctl restart $SERVICE_NAME）
  日志：journalctl -u $SERVICE_NAME -f
EOF
