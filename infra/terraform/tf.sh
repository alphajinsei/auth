#!/usr/bin/env bash
# Cloudflare の API トークンを読み込んで terraform を実行する。
# ターミナルに CLOUDFLARE_API_TOKEN を残さない（残すと wrangler がそちらを使ってしまう）。
# OCI の認証は ~/.oci/config なので、ここでは読まない
set -euo pipefail
# Access の設定（access-idp.tf）は、DNS 用とは別のトークンで変える。そのファイルの CLOUDFLARE_API_TOKEN を、
# 中身を表示せずに Terraform の変数として渡す（サブシェルで読むので、下の DNS 用のトークンとは混ざらない）
TF_VAR_cloudflare_access_api_token=$(set -a; source ~/claude-sandbox/infra/.secrets/terraform-cloudflare.env; printf %s "$CLOUDFLARE_API_TOKEN")
export TF_VAR_cloudflare_access_api_token
set -a
source ~/claude-sandbox/infra/.secrets/terraform-oci-dns.env
set +a
exec terraform "$@"
