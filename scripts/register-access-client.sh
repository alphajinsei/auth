#!/usr/bin/env bash
# npm run register-access-client：auth に Cloudflare Access を client として登録する（ステップ9）。
# infra/terraform を apply したあとに1回。client_secret を作り直したときも、もう一度流す。
# app VM の上で、client_secret を Vault から読み、auth のコンテナの管理用コマンドに標準入力で渡す。手元にも画面にも出ない（sample-auth-client の register-client と同じ）。
# 何度流してもよい（登録済みなら、secret と redirect_uri を合わせ直す）
set -euo pipefail
cd "$(dirname "$0")/.."

CLIENT_ID=cloudflare-access
# Access が auth から戻ってくる先。チーム名は alphajinsei（./tf.sh output access_idp_redirect_url と同じであること）
REDIRECT_URI=https://alphajinsei.cloudflareaccess.com/cdn-cgi/access/callback
SECRET_NAME=$(terraform -chdir=infra/terraform output -raw access_client_secret_secret)

ssh oci-app "cd /opt/apps/auth && platform-secret '$SECRET_NAME' | docker compose exec -T app node dist/admin.js create-client --secret-stdin $CLIENT_ID $REDIRECT_URI 'Cloudflare Access'"
