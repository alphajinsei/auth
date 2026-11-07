# scripts/deploy.sh と scripts/db-init.sh が読む

output "name" {
  value = local.name
}

output "url" {
  value = "https://${local.hostname}"
}

output "port" {
  value = local.port
}

output "mysql_host" {
  value = local.platform.mysql.host
}

output "db_name" {
  value = local.db_name
}

output "db_user" {
  value = local.db_user
}

output "db_password_secret" {
  value = oci_vault_secret.db_password.secret_name
}

# メールの送り先（共通基盤の mail VM）。deploy が .env に書く
output "smtp" {
  value = local.platform.smtp
}

