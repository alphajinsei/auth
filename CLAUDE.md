# auth

既製品を使わずに自作する認証・認可のサーバー（`auth.alphajinsei.com`）。OCI の共通基盤（oci-platform）の Docker ホストに載るアプリの1つで、sample-oci-vm-docker をテンプレートにして作った。目的は、ユーザーが認証・認可を一分野として学ぶことと、動くものを持つことの両方。

- 設計：[docs/design.md](docs/design.md)
- 進め方と進捗：[docs/roadmap.md](docs/roadmap.md)
- 勉強メモ：[docs/notes/study-notes.md](docs/notes/study-notes.md)。長い解説は `docs/notes/extra-*.md`（番外編）に分け、勉強メモからリンクする。分野の全体像は [extra-auth-overview.md](docs/notes/extra-auth-overview.md)、用語は [extra-auth-terms.md](docs/notes/extra-auth-terms.md)
- 図：登場人物の関係図は `docs/diagrams/*.drawio.svg`（architecture-diagram の skill）。通信の順序は Mermaid のシーケンス図を md に直接書く

## 関係するフォルダ

```
~/claude-sandbox/
├── auth/                   this repo (GitHub alphajinsei/auth, public)
├── oci-platform/           the shared platform (Terraform + Ansible). Its README is the app contract
├── sample-oci-vm-docker/   the template this repo was copied from
└── infra/                  overall policy and the infra learning notes (cf-infra-playbook)
```

## 進め方のルール

- コードを書くのもデプロイも Claude が行う。ユーザーは、シーケンス図とコードを読んで理解する側。
- 各段は「来歴の記事（思想・解消した不満・普及した理由。`docs/notes/extra-history-*.md`）→ シーケンス図（`docs/steps/`）→ 実装」の順。図の矢印に対応する粒度で実装する。プロトコルの本質（challenge と署名の検証、PKCE、トークンの発行と検証など）は自分で書く。CBOR などのパース、パスワードのハッシュ、暗号の計算そのものはライブラリに任せる。
- 一度に読む量を少なくする。小さく足しては説明し、ユーザーが理解してから次へ進む。
- 新しく説明したこと、ユーザーが理解したことは、そのつど勉強メモに追記する（確認は不要）。ロードマップの終わった項目にはチェックを付ける。
- 本番へのデプロイ、共通基盤（LB・DNS・Vault）を変える `./tf.sh apply`、コミットと push は、実行する前に確認を取る。
- 公開リポジトリ。秘密情報（パスワード、鍵、トークン）をコードにもドキュメントにも書かない。秘密は Vault（`platform-secret`）か、git 管理外の `.env` に置く。コミットの作者のアドレスは設定済み。
- `~/claude-sandbox/infra/.secrets/` の中身は読まない・表示しない。
- Claude が使う Bash は非対話シェルで nvm が読み込まれない。Node.js のコマンドは `bash -ic '...'` で実行する。
