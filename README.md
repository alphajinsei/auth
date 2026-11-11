# auth

既製品を使わずに自作する、認証・認可のサーバー（IdP）。パスワード、TOTP、パスキー（WebAuthn）でログインでき、OIDC と OAuth 2.0（認可コード + PKCE）でほかのアプリにログインの結果と権限を渡す。OCI の共通基盤（方式③）の Docker ホストに載る。

- 公開先：https://auth.alphajinsei.com
- 設計：[docs/design.md](docs/design.md)、進め方と進捗：[docs/roadmap.md](docs/roadmap.md)、勉強メモ：[docs/notes/](docs/notes/)
- 載せている共通基盤：[oci-platform](https://github.com/alphajinsei/oci-platform)。仕様（アプリが受け取るもの・守ること）、運用、困ったときは [その README](https://github.com/alphajinsei/oci-platform#readme)
- テンプレートにしたサンプル：[sample-oci-vm-docker](https://github.com/alphajinsei/sample-oci-vm-docker)

> 段1（パスワードでのログインとセッション）まで。進み具合は [ロードマップ](docs/roadmap.md)。

## 1. このサービスの用途

自分のサービスのログインを1か所にまとめる。アプリは「auth でログイン」のボタン（OIDC）を置くだけで、どの方式でログインしたかを気にしない。

同時に、認証・認可を学ぶための教材でもある。プロトコルの本質の部分は自分で書き、パースや暗号の計算そのものはライブラリに任せる。

## 2. 構成と主なファイル

```
Browser --> Cloudflare --HTTPS--> OCI LB (listener for this hostname)
                                    |  backend set "auth", health check /health
                                    v
                            app VM :8002 --> container :3000 (src/index.ts, Hono on Node)
                                                |  DB_* from .env (password from Vault)
                                                v
                                     MySQL HeatWave: schema auth

```

登場人物の関係（ブラウザ、demo-app、認証器）は [設計](docs/design.md) の図。メールの送信（テンプレートの `src/mail.ts`）は、まだ使っていない。

| ファイル | 役割 |
| --- | --- |
| `src/index.ts` | 入口（Hono）。POST の `Origin` の確認、`Cache-Control: no-store`、`GET /health`（LB 用。DB を見ない）、`GET /api/health`（DB まで見る）。`PUBLIC_ORIGIN`（外から見た自分の origin）が必須 |
| `src/routes/login.ts` | `GET/POST /login`、`GET /account`、`POST /logout`。失敗の回数による一時停止と、監査ログ（標準出力の JSON） |
| `src/session.ts` | サーバー側のセッション。Cookie `__Host-session` に乱数の ID、DB にその SHA-256 |
| `src/password.ts` | パスワードのハッシュと照合（Argon2id） |
| `src/origin.ts` | CSRF の対策（`Origin` ヘッダーの確認） |
| `src/views.ts` | 画面の HTML |
| `src/admin.ts` | 管理用のコマンド：`create-user <名前>`（パスワードは画面に出さずに読む）、`unlock <名前>` |
| `src/db/schema.ts` | テーブル定義の唯一の正（Drizzle、MySQL） |
| `src/db/client.ts` | DB の接続（環境変数 `DB_HOST` など）。日時は UTC で読み書きする（`timezone: 'Z'`） |
| `src/mail.ts` | メールの送信（nodemailer）。送り先は環境変数 `SMTP_HOST` など、差出人は `MAIL_FROM`（共通基盤の `noreply@`）に表示名を付ける |
| `src/send-test-mail.ts` | 試しに1通送る（`node dist/send-test-mail.js <宛先>`）。誰でも送らせられる口になるので、Web の API にはしない |
| `src/migrate.ts` | マイグレーションを流す（デプロイのとき、コンテナの中で `node dist/migrate.js`） |
| `migrations/` | drizzle-kit が作ったマイグレーションの SQL とスナップショット。手で書かない |
| `Dockerfile` | ビルドして `dist/` を作り、実行用のイメージに入れる |
| `compose.yaml` | 本番と手元で共通。ポートは `.env` の `APP_PORT`（本番は台帳の 8002） |
| `compose.override.yaml` | 手元だけ（自動で重なる）。HeatWave と同じ版の MySQL のコンテナと、メールの受け口の Mailpit、その接続情報 |
| `local.env` | `npm run dev` の接続情報（手元の MySQL。秘密情報ではない） |
| `scripts/deploy.sh` | `npm run deploy`。ソースを app VM に送り、そこでビルドして入れ替える（`remote-deploy.sh` を VM で流す） |
| `scripts/db-init.sh` | `npm run db:init`。初回だけ、ops からスキーマと専用のユーザーを作る（`remote-db-init.sh` を ops で流す） |
| `infra/terraform/` | このアプリが共通基盤に足すもの：LB のホスト名・リスナー・バックエンド・セット（`main.tf`）、DB のパスワード（Vault）、DNS レコード（`cloudflare.tf`）。名前・ポート・DB 名は `main.tf` の `locals` だけに書き、スクリプトは Terraform の出力から読む |

## 3. 手元での開発

```bash
npm install
docker compose up -d mysql     # 手元の MySQL（HeatWave と同じ版）
npm run db:migrate:local       # テーブルを作る（初回と、マイグレーションを足したとき）
npm run dev                    # http://localhost:3000
```

```bash
echo 'correct-horse-battery' | npx tsx --env-file=local.env src/admin.ts create-user alice   # 手元の仮の利用者
```

http://localhost:3000 を開き、上の利用者でログインする。ポートを変えるときは `PORT=3001 PUBLIC_ORIGIN=http://localhost:3001 npm run dev`（`PUBLIC_ORIGIN` が違うと、POST が 403 になる）。

本番と同じコンテナで確かめる：

```bash
docker compose up -d --build                     # app も MySQL もコンテナ。http://localhost:8002
docker compose run --rm app node dist/migrate.js
docker compose down                              # データは残る（消すなら down -v）
```

- 手元で送ったメールを見る：`docker compose up -d mailpit` → `npx tsx --env-file=local.env src/send-test-mail.ts you@example.com` → http://localhost:8025（外へは出ない）
- 手元の DB の中身を見る：`docker compose exec mysql mysql -u app -papp app -e 'SELECT username, failed_count, locked_until FROM users'`

### テーブルを変える

1. `src/db/schema.ts` を直す
2. `npx drizzle-kit generate` で `migrations/` に SQL ができる。中身を読む
3. `npm run db:migrate:local` → `npm run dev` で確かめる
4. `npm run deploy`（本番へのマイグレーションも一緒に流れる）

## 4. ビルドとデプロイ

初回だけ（共通基盤ができていること）：

```bash
cd infra/terraform
./tf.sh init
./tf.sh apply        # LB の振り分け、DB のパスワード（Vault）、DNS レコード
cd ../..
npm run db:init      # ops から、スキーマとユーザーを作る
```

毎回：

```bash
npm run deploy
```

1. ソースを `oci-app:/opt/apps/auth/` に rsync で送る（`node_modules`、`infra/`、手元用のファイルは送らない）
2. app VM の上で：`.env` を書く（DB のパスワードは `platform-secret` で Vault から。メールの送り先は共通基盤の出力 `smtp`） → 今のイメージを `:previous` として残す → `docker compose build`（arm64 でそのままビルド） → マイグレーション → `docker compose up -d` → `/health` が返るまで待つ

マイグレーションが失敗したら、コンテナは入れ替わらない。戻すときは、app VM で `docker tag auth:previous auth:latest && docker compose up -d`（マイグレーションは戻らない）。

## 5. このサービスを使う

アプリから使う（段4で作る）：管理用のコマンドでクライアントを登録し、`https://auth.alphajinsei.com/.well-known/openid-configuration` を OIDC のライブラリに渡す。例は demo-app（段4で作る）。

利用者を作る（段1で作る）：app VM で `docker compose exec app node dist/admin.js create-user <名前>`。登録の画面はない。

## 6. この方式の注意点

- **状態は DB に置く。**コンテナは入れ替えのたびに作り直される。ファイル置き場（Object Storage）は共通基盤にまだないので、要るなら先に共通基盤に足す。
- **`/health` は DB を見ない。**DB を見ると、DB が落ちたときに LB がアプリごと切り離し、エラーの画面すら返せなくなる。
- **入れ替えの数秒は止まる。**Docker ホストが1台なので。
- **MySQL には `RETURNING` がない。**挿入した行は `$returningId()` で ID を受け取ってから読み直す。
- **スキーマは `schema.ts` からだけ変える。**本番に直接 DDL を流すと、Drizzle のスナップショットと実物がずれる。
- **DB のパスワードは Vault にだけある。**手元にもリポジトリにも置かない。app VM の `.env`（権限 600）と、コンテナの設定には残る。作り直すときは `./tf.sh apply -replace=random_password.db` → `npm run db:init` → `npm run deploy`。
- **LB の変更は1つずつ。**OCI の LB は同時に1つの変更しか受け付けない。共通基盤や別のアプリの apply と同時に流さない。
- **DNS レコードは Terraform の管理。**ダッシュボードで直さない（コメントに `managed by Terraform` と出る）。
- **メールの差出人は `noreply@alphajinsei.com` だけ。**ほかのアドレスを `From:` にすると Email Delivery が断る。表示名でアプリを区別する。返信は届かない。
- **メールの宛先を、Web から受け取ったまま使わない。**誰でも好きな相手にメールを送らせられる口になる。送る相手は、ログインした利用者自身など、アプリが決める。送れる数（Email Delivery の無料枠）は全アプリで共有。
