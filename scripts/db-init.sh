#!/usr/bin/env bash
# npm run db:init：初回だけ。ops から HeatWave に、このアプリのスキーマと専用のユーザーを作る。
# 何度流してもよい（ユーザーのパスワードは Vault の値に合わせ直す）
set -euo pipefail
cd "$(dirname "$0")/.."

out() { terraform -chdir=infra/terraform output -raw "$1"; }
ssh oci-ops bash -s -- "$(out mysql_host)" "$(out db_name)" "$(out db_user)" "$(out db_password_secret)" \
  < scripts/remote-db-init.sh
