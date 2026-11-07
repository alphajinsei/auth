# ops の上で動く（db-init.sh が ssh で流し込む）。引数：DB_HOST DB_NAME DB_USER DB_PASSWORD_SECRET
set -euo pipefail
HOST=$1 DB=$2 USER_NAME=$3
APP_PW=$(platform-secret "$4")
# パスワードはコマンドの引数に出さない（ps で見える）。MYSQL_PWD で渡す
MYSQL_PWD=$(platform-secret mysql-admin-password) mysql -h "$HOST" -u admin <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB\`;
CREATE USER IF NOT EXISTS '$USER_NAME'@'%' IDENTIFIED BY '$APP_PW';
ALTER USER '$USER_NAME'@'%' IDENTIFIED BY '$APP_PW';
GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$USER_NAME'@'%';
SQL
echo "database $DB and user $USER_NAME are ready"
