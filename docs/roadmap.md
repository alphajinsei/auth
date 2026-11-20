# ロードマップ：認証基盤

最終更新：2026-11-20

[設計](design.md) を、ステップごとに作っていく。分野の全体像は [番外編：認証・認可の全体像](notes/extra-auth-overview.md)。

## 進め方

- コードとデプロイは Claude が行う。ユーザーは、シーケンス図とコードを読んで理解する側。
- 各ステップは「来歴の記事 → シーケンス図 → 実装」の順に進める。
  - 来歴の記事（`history/<番号>-<技術>.md`）：その技術がどういう思想に基づき、どんな不満を解消し、なぜ普及したか。発見的な経緯と、整理された今の形の両方を見る。
  - シーケンス図（`steps/<ステップ>-*.md`）：流れを理解し、その図の矢印1本1本に対応する処理を実装する。
- 一度に読む量を少なくする。小さく足しては説明し、理解してから次へ進む。どのくらいの粒度にするかは、進めながら調整する。
- 分かったことは [勉強メモ](notes/study-notes.md) に短く、長い解説は番外編（`notes/extra-*.md`）に書く。

## ステップ0：準備

- [x] テンプレート（sample-oci-vm-docker）からリポジトリを作る：`gh repo create auth --public --template alphajinsei/sample-oci-vm-docker --clone`
- [x] 名前を書き換える（Terraform の `locals` と backend の `key`、`package.json`、`compose.yaml`）。ポートは 8002（oci-platform の台帳に追記）
- [x] 設計、ロードマップ、勉強メモ、`CLAUDE.md` を書く。infra から番外編を移す
- [x] 登場人物の関係図（`docs/diagrams/overview.drawio.svg`）

## ステップ0.5：用語と流れを理解する

- [ ] [番外編：認証・認可の全体像](notes/extra-auth-overview.md) を読む
- [ ] [番外編：OAuth・OIDC の用語](notes/extra-auth-terms.md) を読む

## ステップ1：パスワードでのログインとセッション（A・B）

- [x] 来歴：[パスワードとセッション](history/1-password-session.md)
- [x] シーケンス図：[ログイン、以後のリクエスト、ログアウト](steps/1-password-session.md)
- [x] 1-a：メモの API を取り除き、利用者とセッションのテーブルを作る。管理用のコマンドで利用者を作る（Argon2id）
- [x] 1-b：ログイン画面、セッションの Cookie、ログアウト
- [x] 1-c：失敗の回数による一時停止
- [x] 1-d：共通基盤に初めて載せる（`./tf.sh apply`、`npm run db:init`、`npm run deploy`）

## ステップ2：TOTP（A）

- [x] 来歴：[ワンタイムパスワード](history/2-otp.md)（Lamport の鎖、SecurID、HOTP・TOTP、Google Authenticator、SMS の衰退）
- [x] シーケンス図：[登録（QR）とログイン時の確認](steps/2-totp.md)
- [x] 秘密の保存のしかたを決める：暗号化して DB に。鍵は Vault → デプロイで環境変数
- [x] 2-a：6桁を作る計算と照合（RFC 6238 のテスト値で確かめる）
- [x] 2-b：登録（アカウントの画面、QR、確認）
- [x] 2-c：ログイン（仮のセッション、6桁の画面、本物のセッションへの切り替え）
- [x] 2-d：（暗号化するなら）秘密の暗号化と鍵の用意
- [x] 本番に載せて、実際の認証アプリで試す

## ステップ3：パスキー（A）

- [x] 来歴：[FIDO2 とパスキー](history/3-fido.md)（前史の公開鍵の認証、U2F、WebAuthn、同期されるパスキー）
- [x] シーケンス図：[登録とログイン（認証器・ブラウザ・auth）](steps/3-passkey.md)
- [x] 3-a：登録（options、ブラウザの JavaScript、検証、保存。アカウントの画面に一覧）
- [x] 3-b：ログイン（options、署名の検証、セッション。ログイン画面に「パスキーでログイン」）
- [x] 3-c：パスキーだけのアカウント、削除、`amr`、本番で試す（iPhone とパソコンからログイン）

## ステップ4：OIDC（C・D）

- [x] 来歴：[OAuth 2.0 と OpenID Connect](history/4-oauth-oidc.md)（パスワードを渡していた時代、SAML、OpenID 2.0、OAuth 1.0 から）、JWT
- [x] シーケンス図：[認可コード + PKCE、Discovery と JWKS、SSO、/userinfo](steps/4-oidc.md)
- [x] 署名鍵、JWKS、Discovery（4-a。本番の鍵は `./tf.sh apply` のあと）
- [x] `/authorize`、同意画面（4-b）、`/token`、`/userinfo`（4-c）
- [x] demo-app を RP にして「auth でログイン」（まず手元で。4-d）
- [x] 本番に載せ、手元の demo-app から本番の auth でログインする（4-e）

## ステップ5：アクセストークンとリフレッシュトークン（D）

- [x] 来歴：[アクセストークンとリフレッシュトークン](history/5-tokens.md)（OAuth 1.0 の長生きのトークン、WRAP の2本立て、JWT、取り替え、DPoP）
- [x] シーケンス図：[ステップ5の設計](steps/5-tokens.md)（API を呼ぶ、期限切れとリフレッシュ、盗難の検知、ログアウトと取り消し）
- [x] `/userinfo` がアクセストークン（JWT）と scope を検証する（5-a）
- [x] リフレッシュトークンの取り替えと失効（5-b、5-c。demo-app から使うのは 5-d）
- [x] demo-app がトークンを持ち、期限切れでリフレッシュ、ログアウトで取り消す（5-d）
- [x] 本番に載せ、手元の demo-app から本番の auth で試す（5-e）

ステップ5までで、自分のサービスのログインをまとめるには足りる。OIDC の OP として足りていないもの（RS256、`prompt`、ログアウトの連携、鍵の入れ替えなど）は [設計の「OIDC の OP として、足りていないもの」](design.md#oidc-の-op-として足りていないもの)。

## ステップ6：auth を呼ぶ側のひな形

- [x] demo-app をコンテナにし、独立したリポジトリ [sample-auth-client](https://github.com/alphajinsei/sample-auth-client)（Template repository）として共通基盤に載せる。盗難のまねは持っていかない（学ぶための機能なので、auth の demo-app に残す）
- [x] 本番に載せる：`./tf.sh apply`、`npm run db:init`、`npm run register-client`（client_secret は Vault から auth へ流し込み、手元を通さない）、`npm run deploy`

## ステップ7：認可（E。来歴だけ）

2026-11-19：実装はしないことにした。sample-auth-client にメモを足すと、ここまでの認証（authn）の話から論点がずれるため。来歴を読んで終える。

- [x] 来歴：[アクセス制御（認可）](history/7-authorization.md)（アクセス行列、ACL と DAC、MAC、RBAC、ABAC と PEP・PDP、ReBAC と Zanzibar）
- ~~シーケンス図と決めること：PEP（アプリの API）と PDP（判断のモジュール）の分け方、どこに置くか~~
- ~~PDP を作る：関係のタプルを持ち、「Check（主体, 関係, 対象）」に答える~~
- ~~アプリから使う：持ち主だけ・共有した相手・管理者（auth が渡すロール。RBAC を関係の1つとして表す）~~

## ステップ8：LDAP（F。やらない）

2026-11-19：やらないことにした（関心が薄れたため）。項目は記録として残す。

- ~~来歴：X.500 から LDAP、Active Directory まで~~
- ~~番外編：ディレクトリの木構造、bind と search、BER~~
- ~~OpenLDAP を手元のコンテナで動かし、`ldapsearch` を叩く~~

## ステップ9：Cloudflare Access を RP にする（C）

2026-11-20：todo（`todo.alphajinsei.com/admin`）を守る Cloudflare Access に、「auth でログイン」を足す。自分で書いていない RP を、初めてつなぐ。新しい技術ではないので、来歴は書かない。

- [x] 設計とシーケンス図：[ステップ9の設計](steps/9-cloudflare-access.md)
- [x] 9-a：`users.email`、`admin set-email`、`email` scope と `email`・`email_verified` のクレーム
- [x] 9-b：`/token` と `/revoke` で `client_secret_post` も受ける
- [x] 9-c：本番に載せ、自分のアカウントに email を入れる
- [x] 9-d：Terraform に OIDC の IdP を足し、auth に client を登録する（最初は todo の Terraform に置いた）
- [x] 9-d'：IdP を auth の Terraform に移す（todo は `removed`、auth は `import`）。secret を Vault に置き、`npm run register-access-client` で登録し直す
- [x] 9-e：todo の `/admin` に、auth のパスキーでログインする
