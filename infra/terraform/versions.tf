terraform {
  required_version = ">= 1.12"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.11"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }

  # 共通基盤と同じバケット。key はリポジトリ名（コピーしたら必ず書き換える）
  backend "oci" {
    bucket    = "tfstate"
    namespace = "nrliaoyraehn"
    key       = "auth/terraform.tfstate"
    region    = "ap-tokyo-1"
  }
}

provider "oci" {
  # 認証は ~/.oci/config の DEFAULT プロファイルから読む
  region = "ap-tokyo-1"
}
