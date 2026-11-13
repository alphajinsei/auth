# ロードマップ：認証基盤

最終更新：2026-11-14

[設計](design.md) を、段ごとに作っていく。分野の全体像は [番外編：認証・認可の全体像](notes/extra-auth-overview.md)。

## 進め方

- コードとデプロイは Claude が行う。ユーザーは、シーケンス図とコードを読んで理解する側。
- 各段は「来歴の記事 → シーケンス図 → 実装」の順に進める。
  - 来歴の記事（`notes/extra-history-*.md`）：その技術がどういう思想に基づき、どんな不満を解消し、なぜ普及したか。発見的な経緯と、整理された今の形の両方を見る。
  - シーケンス図（`steps/<段>-*.md`）：流れを理解し、その図の矢印1本1本に対応する処理を実装する。
- 一度に読む量を少なくする。小さく足しては説明し、理解してから次へ進む。どのくらいの粒度にするかは、進めながら調整する。
- 分かったことは [勉強メモ](notes/study-notes.md) に短く、長い解説は番外編（`notes/extra-*.md`）に書く。

## 段0：準備

- [x] テンプレート（sample-oci-vm-docker）からリポジトリを作る：`gh repo create auth --public --template alphajinsei/sample-oci-vm-docker --clone`
- [x] 名前を書き換える（Terraform の `locals` と backend の `key`、`package.json`、`compose.yaml`）。ポートは 8002（oci-platform の台帳に追記）
- [x] 設計、ロードマップ、勉強メモ、`CLAUDE.md` を書く。infra から番外編を移す
- [x] 登場人物の関係図（`docs/diagrams/overview.drawio.svg`）

## 段0.5：用語と流れを理解する

- [ ] [番外編：認証・認可の全体像](notes/extra-auth-overview.md) を読む
- [ ] [番外編：OAuth・OIDC の用語](notes/extra-auth-terms.md) を読む

## 段1：パスワードでのログインとセッション（A・B）

- [x] 来歴：[パスワードとセッション](notes/extra-history-password-session.md)
- [x] シーケンス図：[ログイン、以後のリクエスト、ログアウト](steps/1-password-session.md)
- [x] 1-a：メモの API を取り除き、利用者とセッションのテーブルを作る。管理用のコマンドで利用者を作る（Argon2id）
- [x] 1-b：ログイン画面、セッションの Cookie、ログアウト
- [x] 1-c：失敗の回数による一時停止
- [x] 1-d：共通基盤に初めて載せる（`./tf.sh apply`、`npm run db:init`、`npm run deploy`）

## 段2：TOTP（A）

- [x] 来歴：[ワンタイムパスワード](notes/extra-history-otp.md)（Lamport の鎖、SecurID、HOTP・TOTP、Google Authenticator、SMS の衰退）
- [x] シーケンス図：[登録（QR）とログイン時の確認](steps/2-totp.md)
- [x] 秘密の保存のしかたを決める：暗号化して DB に。鍵は Vault → デプロイで環境変数
- [x] 2-a：6桁を作る計算と照合（RFC 6238 のテスト値で確かめる）
- [x] 2-b：登録（アカウントの画面、QR、確認）
- [x] 2-c：ログイン（仮のセッション、6桁の画面、本物のセッションへの切り替え）
- [x] 2-d：（暗号化するなら）秘密の暗号化と鍵の用意
- [x] 本番に載せて、実際の認証アプリで試す

## 段3：パスキー（A）

- [x] 来歴：[FIDO2 とパスキー](notes/extra-history-fido.md)（前史の公開鍵の認証、U2F、WebAuthn、同期されるパスキー）
- [x] シーケンス図：[登録とログイン（認証器・ブラウザ・auth）](steps/3-passkey.md)
- [x] 3-a：登録（options、ブラウザの JavaScript、検証、保存。アカウントの画面に一覧）
- [ ] 3-b：ログイン（options、署名の検証、セッション。ログイン画面に「パスキーでログイン」）
- [ ] 3-c：パスキーだけのアカウント、削除、`amr`、本番で試す

## 段4：OIDC（C・D）

- [ ] 来歴：OAuth 2.0 と OIDC（パスワードを渡していた時代、OAuth 1.0、SAML、OpenID 2.0 から）、JWT
- [ ] シーケンス図：認可コード + PKCE
- [ ] 署名鍵、JWKS、Discovery
- [ ] `/authorize`、同意画面、`/token`、`/userinfo`
- [ ] demo-app を RP にして「auth でログイン」（まず手元で）

## 段5：アクセストークンとリフレッシュトークン（D）

- [ ] シーケンス図：アクセストークンで API を叩く、期限切れ、リフレッシュ
- [ ] `/userinfo` がアクセストークン（JWT）と scope を検証する
- [ ] リフレッシュトークンの取り替えと失効
- [ ] demo-app を独立したリポジトリにし、共通基盤に載せる（今後のサービスのひな形）

## 段6：LDAP（F。学習のみ）

- [ ] 来歴：X.500 から LDAP、Active Directory まで
- [ ] 番外編：ディレクトリの木構造、bind と search、BER
- [ ] OpenLDAP を手元のコンテナで動かし、`ldapsearch` を叩く
