# app VM の上で動く（deploy.sh が rsync で送り、ssh で実行する）。引数：DIR PORT DB_HOST DB_NAME DB_USER DB_PASSWORD_SECRET SMTP_HOST SMTP_PORT SMTP_TLS_NAME MAIL_FROM
set -euo pipefail
DIR=$1 PORT=$2
cd "$DIR"

# 接続情報を .env に書く。パスワードは Vault から（インスタンス・プリンシパル）
umask 077
cat > .env <<ENV
APP_PORT=$PORT
DB_HOST=$3
DB_NAME=$4
DB_USER=$5
DB_PASSWORD=$(platform-secret "$6")
SMTP_HOST=$7
SMTP_PORT=$8
SMTP_TLS_NAME=$9
MAIL_FROM=${10}
ENV

# 今のイメージを previous として残す（戻すときは docker tag <name>:previous <name>:latest → up -d）
IMAGE=$(docker compose config --images app)
docker image inspect "$IMAGE" >/dev/null 2>&1 && docker tag "$IMAGE" "${IMAGE%:*}:previous"

docker compose build
docker compose run --rm -T app node dist/migrate.js   # -T：標準入力をコンテナにつながない
docker compose up -d
docker image prune -f >/dev/null

for _ in $(seq 30); do
  if curl -fsS "localhost:$PORT/health" >/dev/null; then echo "healthy on :$PORT"; exit 0; fi
  sleep 1
done
echo "health check failed" >&2
docker compose logs --tail 50 app >&2
exit 1
