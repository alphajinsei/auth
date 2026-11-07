#!/usr/bin/env bash
# npm run deploy：ソースを app VM に送り、そこでビルドしてコンテナを入れ替える。
# 値（名前、ポート、DB、メールの送り先）は infra/terraform の出力から読む。DB のパスワードは手元を通らない（app VM が Vault から読む）
set -euo pipefail
cd "$(dirname "$0")/.."

out() { terraform -chdir=infra/terraform output -raw "$1"; }
NAME=$(out name)
DIR=/opt/apps/$NAME

echo "==> send source to oci-app:$DIR"
# .env は VM の上で作るもの。送らず、--delete でも消さない
rsync -az --delete --exclude-from=scripts/deploy-exclude.txt ./ "oci-app:$DIR/"

echo "==> build, migrate, and restart on oci-app"
# remote-deploy.sh は上の rsync で送ってあるので、ファイルとして実行する。
# 標準入力で流し込むと、途中の docker compose run がスクリプトの残りを読んでしまい、黙って止まる
smtp() { terraform -chdir=infra/terraform output -json smtp | jq -r ".$1"; }
ssh oci-app bash "$DIR/scripts/remote-deploy.sh" "$DIR" "$(out port)" "$(out mysql_host)" "$(out db_name)" "$(out db_user)" "$(out db_password_secret)" \
  "$(smtp host)" "$(smtp port)" "$(smtp tls_name)" "$(smtp from)"
