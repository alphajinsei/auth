# ---- Cloudflare Access のログインの選択肢「auth.alphajinsei.com」（ステップ9） ----
# Access が OIDC の RP（client_id：cloudflare-access）、auth が OP。流れは docs/steps/9-cloudflare-access.md
# IdP の設定は Cloudflare のアカウントに1つで、Access のどのアプリ（todo など）からも選べる。auth の窓口なので、auth のリポジトリで持つ
# （2026-11-20 に todo のリポジトリから移した。経緯は docs/design.md の「7. 検討の経緯」）

# Access の設定を変えるトークン。cloudflare.tf の DNS 用のトークンとは別のもの（権限：Access の Apps and Policies と、Identity Providers）。
# tf.sh が infra/.secrets/terraform-cloudflare.env から読んで、TF_VAR_cloudflare_access_api_token に入れる
variable "cloudflare_access_api_token" {
  type      = string
  sensitive = true
}

provider "cloudflare" {
  alias     = "access"
  api_token = var.cloudflare_access_api_token
}

locals {
  cloudflare_account_id = "da07fbd6d431eccc008a74d695734e73"
  access_client_id      = "cloudflare-access" # auth に登録する client_id（設計の「登録している client」の台帳）
}

# 移すときに1回だけ使う：todo の state で管理していた、すでにある IdP を、この state に取り込む。
# 取り込みが済んだら、このブロックは消してよい（残しても何もしない）
import {
  to = cloudflare_zero_trust_access_identity_provider.access
  id = "accounts/${local.cloudflare_account_id}/e7f59209-7657-45a0-ab97-ef98abd2874c"
}

# client_secret：Terraform が作って Vault に入れる（sample-auth-client と同じ経路）。
# auth への登録（npm run register-access-client）は、app VM の上で Vault から読んで、auth のコンテナに標準入力で渡す。手元にも画面にも出ない。
# 作り直すときは ./tf.sh apply -replace=random_password.access_client_secret → npm run register-access-client
resource "random_password" "access_client_secret" {
  length  = 43
  special = false # Basic ヘッダーでも本文でも、エンコードの差で食い違わないように英数字だけ
}

resource "oci_vault_secret" "access_client_secret" {
  compartment_id = local.platform.compartment_id
  vault_id       = local.platform.vault_id
  key_id         = local.platform.vault_key_id
  secret_name    = "${local.name}-access-client-secret"
  description    = "client_secret of OIDC client ${local.access_client_id} (Cloudflare Access) at auth"

  secret_content {
    content_type = "BASE64"
    content      = base64encode(random_password.access_client_secret.result)
  }
}

resource "cloudflare_zero_trust_access_identity_provider" "access" {
  provider   = cloudflare.access
  account_id = local.cloudflare_account_id
  name       = "auth.alphajinsei.com" # Access のログイン画面のボタンに出る名前
  type       = "oidc"
  config = {
    client_id     = local.access_client_id
    client_secret = random_password.access_client_secret.result
    # Access は Discovery を読まないので、auth の Discovery（/.well-known/openid-configuration）の値を写す
    auth_url  = "https://${local.hostname}/authorize"
    token_url = "https://${local.hostname}/token"
    certs_url = "https://${local.hostname}/jwks.json" # ID トークンの署名（ES256）を確かめる公開鍵
    # auth は PKCE（S256）を必須にしている
    pkce_enabled = true
    # email scope：ID トークンに email を入れてもらい、Access のアプリのポリシー（メールアドレス）と照らす
    scopes           = ["openid", "email", "profile"]
    email_claim_name = "email"
    # ID トークンの中から、email と amr のほかに取っておくクレーム。Access の利用者の情報の oidc_fields に入り、
    # 管理画面の Test で見える。ポリシーの条件（OIDC Claim）にも使える。学習のために、auth が出す利用者の項目を並べた
    claims = ["sub", "preferred_username", "email_verified", "auth_time"]
  }
}

# npm run register-access-client が読む
output "access_client_secret_secret" {
  value = oci_vault_secret.access_client_secret.secret_name
}

# Access が auth から戻ってくる先（Cloudflare が決める）。register-access-client.sh の REDIRECT_URI と同じであることを確かめる
output "access_idp_redirect_url" {
  value = cloudflare_zero_trust_access_identity_provider.access.config.redirect_url
}
