# ---- このアプリが共通基盤に足すもの：LB の振り分け1つ、DB のパスワード1つ（DNS は cloudflare.tf） ----

locals {
  name     = "auth"                        # フォルダ名 ＝ リポジトリ名 ＝ サブドメイン
  hostname = "${local.name}.alphajinsei.com"
  port     = 8002                          # 共通基盤の README のポートの台帳から
  db_name  = replace(local.name, "-", "_") # MySQL の名前にはハイフンを使わない
  db_user  = replace(local.name, "-", "_")
}

# 共通基盤の出力（LB、VM の IP、Vault など）
data "terraform_remote_state" "platform" {
  backend = "oci"
  config = {
    bucket    = "tfstate"
    namespace = "nrliaoyraehn"
    key       = "oci-platform/terraform.tfstate"
    region    = "ap-tokyo-1"
  }
}

locals {
  platform = data.terraform_remote_state.platform.outputs
}

# ---- LB：ホスト名 → リスナー（443）→ バックエンド・セット → app VM のポート ----
# LB は一度に1つの変更しか受け付けないので、depends_on で順番に作る

resource "oci_load_balancer_backend_set" "app" {
  load_balancer_id = local.platform.lb.id
  name             = local.name
  policy           = "ROUND_ROBIN"

  health_checker {
    protocol    = "HTTP"
    port        = local.port
    url_path    = "/health"
    return_code = 200
  }
}

resource "oci_load_balancer_backend" "app" {
  load_balancer_id = local.platform.lb.id
  backendset_name  = oci_load_balancer_backend_set.app.name
  ip_address       = local.platform.instances.app.private_ip
  port             = local.port
}

resource "oci_load_balancer_hostname" "app" {
  depends_on = [oci_load_balancer_backend.app]

  load_balancer_id = local.platform.lb.id
  name             = local.name
  hostname         = local.hostname
}

resource "oci_load_balancer_listener" "app" {
  load_balancer_id         = local.platform.lb.id
  name                     = local.name
  default_backend_set_name = oci_load_balancer_backend_set.app.name
  hostname_names           = [oci_load_balancer_hostname.app.name]
  port                     = 443
  protocol                 = "HTTP"

  # 証明書は共通基盤のもの（*.alphajinsei.com）。共通基盤の既定のリスナーと同じ設定にする
  ssl_configuration {
    certificate_name        = local.platform.lb.certificate_name
    protocols               = ["TLSv1.2"]
    verify_peer_certificate = false
  }
}

# ---- DB のパスワード：Terraform が作って Vault に入れる。app VM と ops が Vault から読む ----
# 手元のファイルにもリポジトリにも置かない（state には残る。state は非公開のバケットにある）

resource "random_password" "db" {
  length = 32
  # HeatWave のパスワードの規則（validate_password）：大文字・小文字・数字・記号をそれぞれ1文字以上
  min_upper        = 1
  min_lower        = 1
  min_numeric      = 1
  min_special      = 1
  override_special = "-_" # .env と SQL にそのまま書けるように、記号を絞る
}

resource "oci_vault_secret" "db_password" {
  compartment_id = local.platform.compartment_id
  vault_id       = local.platform.vault_id
  key_id         = local.platform.vault_key_id
  secret_name    = "${local.name}-db-password"
  description    = "MySQL password of user ${local.db_user}"

  secret_content {
    content_type = "BASE64"
    content      = base64encode(random_password.db.result)
  }
}

# ---- TOTP の秘密を暗号化する鍵（AES-256 の 32バイト）：Terraform が作って Vault に入れる。app VM が Vault から読む ----
# DB のパスワードと同じ経路。デプロイのときに .env の TOTP_KEY に書かれる（src/secretbox.ts）。
# 作り直すと、DB に入っている TOTP の秘密が全部読めなくなる（全員が TOTP を登録し直し）。-replace しない

resource "random_bytes" "totp_key" {
  length = 32
}

resource "oci_vault_secret" "totp_key" {
  compartment_id = local.platform.compartment_id
  vault_id       = local.platform.vault_id
  key_id         = local.platform.vault_key_id
  secret_name    = "${local.name}-totp-key"
  description    = "AES-256 key (base64) that encrypts TOTP secrets in the DB"

  secret_content {
    content_type = "BASE64"
    content      = base64encode(random_bytes.totp_key.base64) # 中身は「鍵の base64 の文字列」。platform-secret はそれを返す
  }
}
