# ---- Cloudflare（OCI の外）：このアプリの DNS レコードだけ ----

provider "cloudflare" {
  # 認証は環境変数 CLOUDFLARE_API_TOKEN から読む（tf.sh が .secrets から読み込む）。権限は DNS Edit
}

resource "cloudflare_dns_record" "app" {
  zone_id = local.platform.cloudflare_zone_id
  name    = local.hostname
  type    = "A"
  content = local.platform.lb.public_ip
  proxied = true # Cloudflare を通す（LB は Cloudflare の IP からしか受けない）
  ttl     = 1    # proxied のときは 1（自動）
  comment = "managed by Terraform: ${local.name}"
}
