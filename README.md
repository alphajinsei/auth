# sample-oci-vm-docker

方式③（OCI の共通基盤）のサンプル。Node.js + Hono + MySQL（HeatWave）+ Drizzle で作ったメモ帳の API を、共通基盤の Docker ホストにコンテナで載せる。②の [sample-cf-workers-d1](https://github.com/alphajinsei/sample-cf-workers-d1) と同じ API を、Workers + D1 から載せ替えたもの。

- 公開先：https://sample-oci-vm-docker.alphajinsei.com
- 載せている共通基盤：[oci-platform](https://github.com/alphajinsei/oci-platform)（手元では `~/claude-sandbox/oci-platform`）
- 全体の方針と、どの方式でも共通の決まりごと：[サービス開発ガイド](https://github.com/alphajinsei/cf-infra-playbook/blob/main/docs/service-guide.md)（手元では `~/claude-sandbox/infra/docs/service-guide.md`）
- 共通基盤の仕様（アプリが受け取るもの・守ること）、運用、困ったとき：[oci-platform の README](https://github.com/alphajinsei/oci-platform#readme)

## 1. この方式の用途

向いているもの：Workers で動かないもの。常駐プロセス、WebSocket の常時接続、Node.js 専用のライブラリ、任意の言語、コンテナで配られている OSS、MySQL で動くもの。

向いていないもの：PostgreSQL や Redis が必須なもの（共通基盤にない。必要なら app にコンテナで置き、単一障害点として割り切る）、大きなファイルの配信（LB が 10Mbps）、HTTP 以外の通信。Workers で足りるものは②のほうが手間がない。

## 2. 構成と主なファイル

```
Browser --> Cloudflare --HTTPS--> OCI LB (listener for this hostname)
                                    |  backend set "sample-oci-vm-docker", health check /health
                                    v
                            app VM :8001 --> container :3000 (src/index.ts, Hono on Node)
                                                |  DB_* from .env (password from Vault)
                                                v
                                     MySQL HeatWave: schema sample_oci_vm_docker

container --SMTP 25 (no login, inside the VCN)--> mail VM (Postfix) --> Email Delivery --> recipient
          From: "sample-oci-vm-docker" <noreply@alphajinsei.com>
```

| ファイル | 役割 |
| --- | --- |
| `src/index.ts` | アプリ本体（Hono）。`GET /health`（LB 用。DB を見ない）、`GET /api/health`（DB まで見る）、`GET/POST /api/memos`、`DELETE /api/memos/:id`。`public/` の静的ファイルも返す |
| `src/db/schema.ts` | テーブル定義の唯一の正（Drizzle、MySQL） |
| `src/db/client.ts` | DB の接続（環境変数 `DB_HOST` など） |
| `src/mail.ts` | メールの送信（nodemailer）。送り先は環境変数 `SMTP_HOST` など、差出人は `MAIL_FROM`（共通基盤の `noreply@`）に表示名を付ける |
| `src/send-test-mail.ts` | 試しに1通送る（`node dist/send-test-mail.js <宛先>`）。誰でも送らせられる口になるので、Web の API にはしない |
| `src/migrate.ts` | マイグレーションを流す（デプロイのとき、コンテナの中で `node dist/migrate.js`） |
| `migrations/` | drizzle-kit が作ったマイグレーションの SQL とスナップショット。手で書かない |
| `Dockerfile` | ビルドして `dist/` を作り、実行用のイメージに入れる |
| `compose.yaml` | 本番と手元で共通。ポートは `.env` の `APP_PORT`（本番は台帳の 8001） |
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
curl http://localhost:3000/api/memos
curl -X POST http://localhost:3000/api/memos -H "Content-Type: application/json" -d '{"text":"はじめてのメモ"}'
curl -X DELETE http://localhost:3000/api/memos/1 -i
```

本番と同じコンテナで確かめる：

```bash
docker compose up -d --build                     # app も MySQL もコンテナ。http://localhost:8001
docker compose run --rm app node dist/migrate.js
docker compose down                              # データは残る（消すなら down -v）
```

- 手元で送ったメールを見る：`docker compose up -d mailpit` → `npx tsx --env-file=local.env src/send-test-mail.ts you@example.com` → http://localhost:8025（外へは出ない）
- 手元の DB の中身を見る：`docker compose exec mysql mysql -u app -papp app -e 'SELECT * FROM memos'`

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

1. ソースを `oci-app:/opt/apps/sample-oci-vm-docker/` に rsync で送る（`node_modules`、`infra/`、手元用のファイルは送らない）
2. app VM の上で：`.env` を書く（DB のパスワードは `platform-secret` で Vault から。メールの送り先は共通基盤の出力 `smtp`） → 今のイメージを `:previous` として残す → `docker compose build`（arm64 でそのままビルド） → マイグレーション → `docker compose up -d` → `/health` が返るまで待つ

マイグレーションが失敗したら、コンテナは入れ替わらない。戻すときは、app VM で `docker tag sample-oci-vm-docker:previous sample-oci-vm-docker:latest && docker compose up -d`（マイグレーションは戻らない）。

## 5. このサンプルから新しいサービスを始める

GitHub の Template repository にしてあるので、履歴なしでコピーできる。`<name>` は新しいサービスの名前（＝フォルダ名 ＝ リポジトリ名 ＝ サブドメイン）。

```bash
cd ~/claude-sandbox
gh repo create <name> --template alphajinsei/sample-oci-vm-docker --public --clone
cd <name>
npm install
```

書き換える場所：

| ファイル | 書き換えるところ |
| --- | --- |
| `~/claude-sandbox/oci-platform/README.md` | ポートの台帳に1行足す（空いている番号を取る） |
| `infra/terraform/main.tf` | `locals` の `name` と `port` |
| `infra/terraform/versions.tf` | backend の `key`（`<name>/terraform.tfstate`）。変え忘れると、サンプルの state を上書きする |
| `package.json` | `name` |
| `compose.yaml` | `image`（`<name>:latest`）と、`APP_PORT` の既定値 |
| `src/db/schema.ts` | メモのテーブルを、新しいサービスのテーブルに置き換える |
| `migrations/` | フォルダごと消してから `npx drizzle-kit generate` で作り直す |
| `src/index.ts` | メモの API を置き換える。`/health` は残す（LB が見る） |
| `public/index.html` | 画面 |
| `README.md` | このファイルを新しいサービスの説明に書き直す（見出しはそのまま） |

書き換えたあとは、3 で手元で確かめ、4 の「初回だけ」と `npm run deploy`。

- infra で Claude Code を開いて作業するなら、`~/claude-sandbox/infra/.claude/settings.json` の `additionalDirectories` に `~/claude-sandbox/<name>` を足す。

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
