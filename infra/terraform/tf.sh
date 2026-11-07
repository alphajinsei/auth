#!/usr/bin/env bash
# Cloudflare の API トークンを読み込んで terraform を実行する。
# ターミナルに CLOUDFLARE_API_TOKEN を残さない（残すと wrangler がそちらを使ってしまう）。
# OCI の認証は ~/.oci/config なので、ここでは読まない
set -euo pipefail
set -a
source ~/claude-sandbox/infra/.secrets/terraform-oci-dns.env
set +a
exec terraform "$@"
