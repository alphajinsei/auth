# ステップ4：OIDC（認可コード + PKCE）

最終更新：2026-11-15

背景は [番外編：OAuth 2.0 と OpenID Connect の来歴](../notes/extra-history-oauth-oidc.md)、用語は [番外編：OAuth・OIDC の用語](../notes/extra-auth-terms.md)。demo-app の「auth でログイン」を押すと auth に移り、ステップ1〜3のどれかでログインし、demo-app に戻ってくると、demo-app が「誰がログインしたか」を知っている、までを作る。

## この文書の読み方

| 節 | 中身 |
| --- | --- |
| 1. 技術の要素 | 認可コード + PKCE を、9つの要素に分ける。以下の節は、この番号で読む |
| 2. 登場人物 | 用語の表 |
| 3. 仕組みの補足 | 表だけでは分かりにくいところ（ブラウザが運び役になる、2つのセッション、state と PKCE と nonce の違い） |
| 4. 流れ | 誰が何を作るかの文章と、シーケンス図（ログイン、準備、2つ目以降のログイン） |
| 5. 実装 | 決めること、テーブル、小分け |

**番号が2種類ある**のはステップ3と同じ。1 の表の ①〜⑨ は**要素**の番号、4 の図の丸数字は**手順**（矢印）の番号。コードのコメントでは「要素③」「ログイン 7」「ログイン 7 のあとの Note」と書き分ける。

## 1. 技術の要素：9つの組み合わせ

| # | 要素 | 何を保証するか | 由来 |
| --- | --- | --- | --- |
| ① | **リダイレクトで、ブラウザを運び役にする** | demo-app と auth が直接つながっていなくても（demo-app が手元の localhost でも）、利用者のブラウザが要求と応答を運ぶ | SAML、OpenID 2.0 |
| ② | **redirect_uri の事前登録と完全一致** | auth が結果を返す先は、demo-app が登録した URL だけ。偽サイトが「結果をこちらへ」と頼めない | OAuth 2.0（Security BCP で完全一致に） |
| ③ | **同意** | 利用者が、demo-app に何を渡すか（scope）を自分で許す | OAuth 1.0 |
| ④ | **認可コード** | ブラウザが運ぶのは、短命・一度きりの引換券だけ。トークンそのものは URL に載らない（履歴やリファラーから漏れない） | OAuth 2.0 |
| ⑤ | **裏の通信で引き換える（client の認証付き）** | コードをトークンに引き換えられるのは、client_secret を持つ demo-app のサーバーだけ | OAuth 2.0 |
| ⑥ | **PKCE** | コードを横取りされても、最初に乱数を作った本人（demo-app）でなければ引き換えられない | RFC 7636（2015年） |
| ⑦ | **state** | 戻ってきた応答が、自分（このブラウザの demo-app）が始めた要求への応答か（ログインの CSRF の対策） | OAuth 2.0 |
| ⑧ | **ID トークン（署名、iss・aud・exp）** | 誰がログインしたかを、auth が署名して demo-app 宛てに書いたもの。宛先が違えば拒む（すり替えの対策） | SAML のアサーション、JWT |
| ⑨ | **nonce** | ID トークンが、今回の要求のために作られたもの（使い回しでない） | OIDC |

- **ログイン** ＝ demo-app が ⑥⑦⑨ の乱数を作る → ① ブラウザを auth へ送る → auth は ② を確かめ、利用者にログインさせ、③ 同意をもらう → ④ コードを ① で demo-app へ返す → demo-app は ⑦ を確かめ、⑤ 裏の通信で ⑥ の乱数と一緒にコードを引き換える → auth は ②④⑤⑥ を確かめ、⑧⑨ の ID トークンに署名して返す → demo-app は ⑧⑨ を確かめる

ステップ3のパスキーと同じ骨格がある。⑨ の nonce はステップ3の challenge、⑧ の aud はステップ3の RP ID、⑧ の署名はステップ3の署名に当たる。違うのは、**署名する側が利用者の認証器ではなく auth** で、**検証する側が auth ではなく demo-app** なこと（RP が層によって違う、の OIDC の層）。

## 2. 登場人物

| 名前 | 何か | このリポジトリでは |
| --- | --- | --- |
| OP（OpenID Provider）＝ 認可サーバー | ログインさせ、ID トークンとアクセストークンを出す側 | auth（`https://auth.alphajinsei.com`、手元は `http://localhost:3001`） |
| RP（Relying Party）＝ client | OP の ID トークンを信じて、利用者をログインさせる側 | demo-app（`http://localhost:4000`） |
| issuer | OP の識別子（URL）。ID トークンの `iss` に入り、RP はこれが期待どおりか確かめる | auth の origin |
| client_id、client_secret | RP の名前と、RP のサーバーだけが持つ合言葉。auth に事前に登録する | `demo-app` と、登録のときに一度だけ表示する乱数 |
| redirect_uri | auth が結果（認可コード）を返す先。事前に登録した値と完全一致させる | `http://localhost:4000/callback` |
| scope | RP が求めるもの。`openid` があれば OIDC の要求 | `openid profile`（ID と、ユーザー名） |
| 認可コード | ブラウザが運ぶ引換券。60秒、一度きり | 32バイトの乱数 |
| ID トークン | 誰が、いつ、どうやってログインしたか。auth が署名した JWT | ES256 で署名 |
| アクセストークン | `/userinfo` を呼べる許可証（ステップ5で本格的に使う） | ステップ4は乱数（DB で引く）。ステップ5で JWT にするか決める |
| JWKS | auth の公開鍵の一覧。RP は ID トークンの署名をこれで確かめる | `/jwks.json` |
| Discovery | auth の設定（各 URL、使える方式）の一覧 | `/.well-known/openid-configuration` |

## 3. 仕組みの補足

### client の事前登録

auth は demo-app のことを事前に知っておく必要がある。登録するのは、client_id（どのアプリか。同意画面に出す名前）、redirect_uri（結果を返す先）、client_secret（裏の通信で demo-app だと確かめる合言葉）。一番大事なのは redirect_uri で、登録がないと、攻撃者が redirect_uri に自分のサイトを書いた要求に利用者を送り込み、利用者が正規に同意した認可コードを受け取れてしまう。

登録のしかたは IdP によって違う。Google は開発者が Cloud Console で自分で登録する（重い scope は審査あり）。企業の IdP は管理者が登録する。API で自動登録する仕組み（Dynamic Client Registration、RFC 7591）もある。このリポジトリは管理用のコマンドで登録する。

### ブラウザが運び役になる（表の通信と裏の通信）

通信には2種類ある。

| | 表の通信（front channel） | 裏の通信（back channel） |
| --- | --- | --- |
| 経路 | ブラウザのリダイレクト。demo-app → ブラウザ → auth → ブラウザ → demo-app | demo-app のサーバーから auth へ、直接の HTTPS |
| 運ぶもの | 要求（client_id、redirect_uri、state など）と、認可コード | 認可コードと client_secret と code_verifier を送り、トークンを受け取る |
| 見える人 | 利用者、ブラウザの履歴、拡張機能、（スマホなら）ほかのアプリ | demo-app と auth だけ |
| 図では | ログイン 3〜4、9〜10 | ログイン 11〜13 |

**大事なものは裏で渡す**のが、認可コードの流れの考え方。理由は2つある。表の通信は漏れやすい（URL は履歴、Referer、アクセスログ、拡張機能、スマホではほかのアプリに残る）。そして表の通信では、auth は「この URL へ行け」と言うだけで、行った先で誰が受け取ったかを確かめられない。裏の通信なら、client_secret で相手を確かめてから渡せる。

認可コードは「同意した」という証明ではなく、**`/authorize` で決まったこと全部（誰が、どうやってログインしたか、どの client、redirect_uri、同意した scope、code_challenge、nonce）を指す引換券**。何を許すかは表で全部決まっていて、品物（トークン）は裏で引き換える。クロークの番号札と同じ。URL に直接トークンを載せる方式（implicit）もあったが、漏れやすいので今は使わない。

表を通るのは、盗まれても単独では使えないもの（短命・一度きりのコード）だけにする。手元では demo-app が localhost にあり、auth から demo-app へは直接つながれないが、表の通信は利用者のブラウザが運ぶので問題ない。裏の通信は demo-app から auth へ向かうだけなので、これも成り立つ。

### 2つのセッション

ログインが終わると、Cookie が2つできる。

| Cookie | 誰のもの | 意味 |
| --- | --- | --- |
| auth のセッション（`__Host-session`） | auth | 「この利用者は auth にログイン済み」。ステップ1〜3のもの |
| demo-app のセッション | demo-app | 「この利用者は demo-app にログイン済み」。ID トークンを確かめたあとに demo-app が作る |

2つ目のアプリが「auth でログイン」したとき、auth のセッションが生きていれば、ログイン画面を出さずにすぐ戻す。**これが SSO の正体**（4 の「2つ目以降のログイン」の図）。逆に、demo-app からログアウトしても auth のセッションは残る（ログアウトの連携は [設計](../design.md) の「今後の発展」）。

手元では、auth（`localhost:3001`）と demo-app（`localhost:4000`）が同じホスト名になる。**Cookie はポートで分かれない**ので、2つのアプリの Cookie は同じ名前にしない（demo-app は `__Host-demo-session` にする）。本番ではドメインが分かれるので、この心配はない。

### state、PKCE、nonce の違い

3つとも「RP が最初に乱数を作り、あとで照らす」もので、似ている。守るものが違う。

| | 作る人 | どこに入れて送るか | どこで照らすか | 防ぐ攻撃 |
| --- | --- | --- | --- | --- |
| ⑦ state | demo-app | `/authorize` の URL。そのまま戻ってくる | demo-app（ログイン 10 のあとの Note） | 攻撃者が自分のコードを被害者のブラウザに踏ませ、被害者を**攻撃者のアカウント**でログインさせる（ログインの CSRF） |
| ⑥ PKCE | demo-app | `/authorize` に code_challenge（ハッシュ）、`/token` に code_verifier（元の乱数） | auth（ログイン 12 のあとの 1つ目の Note） | 認可コードの横取り。コードだけでは引き換えられない |
| ⑨ nonce | demo-app | `/authorize` の URL。auth が ID トークンの中に入れる | demo-app（ログイン 13 のあとの Note） | ID トークンの使い回し、別の要求への差し替え |

PKCE は state の役も果たせる（攻撃者のコードは、被害者のブラウザの code_verifier と合わない）ので、最近の指針（RFC 9700）では、PKCE があれば state は必須ではないとされる。このリポジトリでは、学ぶために3つとも入れる。

### client_secret と PKCE を両方使う理由

PKCE は、もとは client_secret を安全に持てないアプリ（スマホのアプリ、ブラウザだけのアプリ）のための仕組みだった。demo-app はサーバーを持つので client_secret を持てる（**confidential client**）。それでも RFC 9700 は、confidential client にも PKCE を勧めている。client_secret は「引き換えに来たのが demo-app か」、PKCE は「引き換えに来たのが、このコードの要求を始めた demo-app のこのセッションか」を確かめるもので、守るものが違うため。

## 4. 流れ

### 全体：誰が何を作り、何を渡すか

1. **demo-app** が乱数を3つ作る（state、nonce、code_verifier）。code_verifier のハッシュ（code_challenge）も作る。3つの元の値は、短命の Cookie に入れて覚える。
2. **demo-app** が、ブラウザを auth の `/authorize` へリダイレクトさせる。URL に client_id、redirect_uri、scope、state、nonce、code_challenge を載せる。
3. **auth** が client_id と redirect_uri を登録と照らす。利用者が auth にログインしていなければ、ログイン画面（ステップ1〜3）を挟む。同意がまだなら、同意画面を出す。
4. **auth** が認可コードを作り、そのコードに「誰が、どうやってログインしたか（amr）、どの client に、どの redirect_uri で、code_challenge、nonce」を結び付けて DB に置く。ブラウザを redirect_uri へ、コードと state を付けてリダイレクトさせる。
5. **demo-app** が、戻ってきた state を Cookie の値と照らす。
6. **demo-app** のサーバーが、auth の `/token` に直接、コード、redirect_uri、code_verifier、client_id と client_secret を送る。
7. **auth** が client を認証し、コードを取り出して消し（一度きり）、redirect_uri と、`SHA-256(code_verifier)` が code_challenge と一致するかを確かめる。ID トークン（iss、sub、aud、exp、iat、nonce、amr、auth_time）を作って秘密鍵で署名し、アクセストークンと一緒に返す。
8. **demo-app** が、auth の公開鍵（JWKS）で ID トークンの署名を確かめ、iss、aud、exp、nonce を照らす。通れば、sub を「ログインした人」として、自分のセッションを作る。

### ログイン（認可コード + PKCE）

```mermaid
sequenceDiagram
  autonumber
  actor U as 利用者
  participant B as ブラウザ
  participant R as demo-app（RP）
  participant A as auth（OP）
  participant DB as MySQL（auth）

  U->>B: demo-app で「auth でログイン」を押す
  B->>R: GET /login
  Note over R: state、nonce、code_verifier を乱数で作り、短命の Cookie に覚える。code_challenge ＝ SHA-256（code_verifier）
  R-->>B: 302 → auth の /authorize（client_id、redirect_uri、scope、state、nonce、code_challenge）
  B->>A: GET /authorize（同じもの）
  Note over A: client_id が登録済みか、redirect_uri が登録と完全一致するか
  Note over A: auth にログインしていなければ、ログイン画面へ（ステップ1〜3）。済んだら /authorize に戻る
  A-->>B: 同意画面「demo-app に、あなたの ID とユーザー名を渡します」
  U->>B: 「許可する」
  B->>A: POST /authorize（同意）
  Note over A: 認可コードを作る（60秒、一度きり）。利用者、amr、client_id、redirect_uri、code_challenge、nonce と結び付ける
  A->>DB: 認可コードを保存。同意を記録
  A-->>B: 302 → demo-app の /callback（code、state）
  B->>R: GET /callback（code、state）
  Note over R: state が Cookie の値と一致するか
  R->>A: POST /token（code、redirect_uri、code_verifier、client_id と client_secret）。裏の通信
  Note over A: client を認証する（client_secret）
  A->>DB: 認可コードを取り出して消す（一度きり）
  Note over A: コードの期限、client_id、redirect_uri が一致するか。SHA-256（code_verifier）が code_challenge と一致するか
  Note over A: ID トークンを作り、秘密鍵で署名する（iss、sub、aud、exp、iat、nonce、amr、auth_time）
  A-->>R: ID トークン、アクセストークン
  Note over R: auth の公開鍵（JWKS）で署名を確かめ、iss、aud、exp、nonce を照らす
  R-->>B: Set-Cookie（demo-app のセッション）、トップへ。「ようこそ、〇〇さん」
```

#### 図「ログイン」とコードの対応

| 手順 | 図の中身 | コード |
| --- | --- | --- |
| ログイン 1〜2 | 「auth でログイン」→ GET /login | [demo-app/src/index.ts](../../demo-app/src/index.ts) の `GET /login` |
| ログイン 2 のあとの Note | state、nonce、code_verifier を作り、Cookie に覚える | [demo-app/src/rp.ts](../../demo-app/src/rp.ts) の `newLoginRequest`。3つを JSON にして `__Host-demo-login` の Cookie へ（10分、`SameSite=Lax`） |
| ログイン 3 | 302 → /authorize | `GET /login` の最後の `c.redirect`。URL は Discovery の `authorization_endpoint` |
| ログイン 4 | GET /authorize | [src/routes/oidc.ts](../../src/routes/oidc.ts) の `GET /authorize` |
| ログイン 4 のあとの 1つ目の Note | client_id と redirect_uri を照らす | 同じファイルの `checkRequest`（要素②）。外れたら auth の画面にエラー（`authorizeErrorPage`）。そのあとの検査（response_type、openid、PKCE、state）の失敗は redirect_uri へ `error=` で返す |
| ログイン 4 のあとの 2つ目の Note | ログインしていなければログイン画面へ | `currentUser` が空なら、[src/session.ts](../../src/session.ts) の `rememberReturnTo` で戻り先を Cookie に覚えて `/login` へ。ログインが済んだら `takeReturnTo` で戻る（パスワード、TOTP、パスキーのどれでも） |
| ログイン 5 | 同意画面 | `hasConsent` が偽なら、[src/views.ts](../../src/views.ts) の `consentPage`。真なら同意画面を飛ばして、ログイン 7 のあとの Note へ（図「2つ目以降のログイン」） |
| ログイン 6〜7 | 「許可する」→ POST /authorize | `POST /authorize`。隠し項目をもう一度 `checkRequest` で照らす。「許可しない」なら `error=access_denied` |
| ログイン 7 のあとの Note | 認可コードを作る | `issueCode`（要素④） |
| ログイン 8 | 認可コードを保存、同意を記録 | `db.insert(authorizationCodes)`、`db.insert(oauthConsents)` |
| ログイン 9 | 302 → /callback（code、state） | `issueCode` の最後の `c.redirect` |
| ログイン 10 | GET /callback（code、state） | [demo-app/src/index.ts](../../demo-app/src/index.ts) の `GET /callback`。`__Host-demo-login` を読んで消す（一度きり） |
| ログイン 10 のあとの Note | state が Cookie の値と一致するか | `q.state !== login.state` なら 400。`error=` の戻りも、state を確かめてから信じる |
| ログイン 11（demo-app の側） | POST /token | `exchangeCode`。`Authorization: Basic`（client_id と client_secret）、本文に code、redirect_uri、code_verifier |
| ログイン 11 | POST /token | [src/routes/oidc.ts](../../src/routes/oidc.ts) の `POST /token`。サーバー同士の通信で Origin が付かないので、[src/origin.ts](../../src/origin.ts) の Origin の確認から外している（Cookie を使わず、毎回 client_secret を見せるので CSRF の心配がない） |
| ログイン 11 のあとの Note | client を認証する | `authenticateClient`。`Authorization: Basic` の client_id と client_secret を取り出し、SHA-256 を DB の `secret_hash` と `timingSafeEqual` で比べる。外れたら 401 `invalid_client` |
| ログイン 12 | 認可コードを取り出して消す | `takeCode`。読んでから消し、消せた（`affectedRows === 1`）ときだけ使う。先に期限切れのコードを掃除する |
| ログイン 12 のあとの 1つ目の Note | 期限、client_id、redirect_uri、PKCE | `POST /token` の中の `if` の並び。どれで外れても 400 `invalid_grant`。PKCE は `SHA-256(code_verifier)` の base64url を `code_challenge` と比べる（要素⑥） |
| ログイン 12 のあとの 2つ目の Note | ID トークンを作って署名する | `signJwt({ iss, sub, aud, exp, iat, auth_time, nonce, amr, preferred_username })`（署名は [src/jwt.ts](../../src/jwt.ts)、要素⑧） |
| ログイン 13 | ID トークン、アクセストークン | `c.json({ access_token, token_type: 'Bearer', expires_in, scope, id_token })`。アクセストークンは乱数で、SHA-256 を `access_tokens` に置く |
| ログイン 13 のあとの Note | 署名と中身を確かめる | [demo-app/src/rp.ts](../../demo-app/src/rp.ts) の `verifyIdToken`：alg（ES256 だけ）、kid で鍵を選ぶ、署名、iss、aud、exp、iat、nonce の順。知らない kid なら JWKS を1回だけ取り直す（`verifyWithRefresh`）。続けて `/userinfo` を呼び、sub が一致するかも確かめる |
| ログイン 14 | demo-app のセッションを作り、トップへ | 乱数のセッション ID を `__Host-demo-session` に置き、中身（ID トークンの中身と /userinfo の返事）はメモリの `Map` に。トップの画面に表示する |

- **redirect_uri の完全一致**（ログイン 4 のあとの 1つ目の Note）。前方一致や、ワイルドカードを許すと、`https://demo.example.com/callback/../evil` のような抜け道で、コードを別の場所に送らせられる。登録した文字列と、1文字残らず同じであることを求める。
- **redirect_uri を `/token` でもう一度送る**のは、コードを出したときの redirect_uri と同じかを auth が確かめるため（コードを別の client の流れに持ち込ませない）。
- **同意は記録する**。同じ利用者・同じ client・同じ scope なら、次からは同意画面を出さない（「2つ目以降のログイン」）。
- **ID トークンの amr** には、ステップ1〜3で記録したセッションの amr（`pwd`、`pwd otp mfa`、`hwk mfa` など）をそのまま入れる。demo-app は、パスキーに一切触れずに「多要素でログインした」と分かる。
- 断るときの扱い。redirect_uri が登録と違う、client_id が不明、のときは、**redirect_uri へ戻さず**、auth の画面にエラーを出す（偽の redirect_uri にエラーを送ると、それ自体が攻撃の足がかりになる）。それ以外（利用者が同意を断った、など）は、redirect_uri に `error=access_denied` と state を付けて戻す。
- **`/token` の失敗は、どこで外れても `invalid_grant`**（コードが不明・使用済み、期限切れ、client 違い、redirect_uri 違い、PKCE 違い）。どこが違ったかを相手に教えない（`error_description` には書くが、auth のログで追うためのもの）。client の認証の失敗だけは 401 `invalid_client`。
- **失敗してもコードは消える**。取り出した時点で消すので、PKCE を間違えたら、そのコードは二度と使えない（横取りした人が verifier を総当たりできない）。
- **使い回しの検知はしていない**。仕様は「同じコードが2回来たら、1回目で出したトークンも取り消すべき」（RFC 6749 4.1.2）としているが、そのためには使ったコードと出したトークンの結び付きを残す必要がある。ステップ4では、消すだけにする。
- **寿命**。認可コード 60秒、ID トークン 10分（受け取ってすぐ確かめて使い終わるので、短くてよい）、アクセストークン 1時間。
- **amr は配列**で入れる（RFC 8176。`"pwd otp mfa"` は `["pwd", "otp", "mfa"]` になる）。DB とセッションでは空白区切りの文字列で持っている。

### 準備：Discovery と JWKS（demo-app が起動するとき）

```mermaid
sequenceDiagram
  autonumber
  participant R as demo-app（RP）
  participant A as auth（OP）

  R->>A: GET /.well-known/openid-configuration
  A-->>R: issuer、authorization_endpoint、token_endpoint、userinfo_endpoint、jwks_uri、使える方式（ES256、S256 など）
  R->>A: GET /jwks.json
  A-->>R: 公開鍵の一覧（kid ごと）
  Note over R: 覚えておく。ID トークンのヘッダーの kid が知らない値なら、取り直す（鍵の入れ替えに追従する）
```

#### 図「準備」とコードの対応

| 手順 | 図の中身 | コード |
| --- | --- | --- |
| 準備 1 → 2 | Discovery | [src/routes/oidc.ts](../../src/routes/oidc.ts) の `GET /.well-known/openid-configuration` |
| 準備 3 → 4 | JWKS | 同じファイルの `GET /jwks.json` → [src/jwt.ts](../../src/jwt.ts) の `jwks`（秘密鍵から公開鍵を作り、`kid` は公開鍵の指紋＝JWK Thumbprint） |
| 準備 1 → 4（demo-app の側） | Discovery、JWKS を取りに行く | [demo-app/src/rp.ts](../../demo-app/src/rp.ts) の `discover`（中身の issuer が、取りに行った issuer と同じかも確かめる）、`fetchJwks` |
| 準備 4 のあとの Note | 覚えておく | [demo-app/src/index.ts](../../demo-app/src/index.ts) の `config`。起動のときではなく、最初のログインのときに取りに行く（auth が止まっていても demo-app は起動できる） |

- demo-app に渡す設定は、auth の URL（issuer）と、client_id、client_secret の3つだけ。各 URL は Discovery から読む。
- 公開鍵は秘密ではないので、誰でも取れる。署名に使う秘密鍵は auth だけが持つ（Vault に置く。5 の「決めること」）。

### 2つ目以降のログイン（SSO）

```mermaid
sequenceDiagram
  autonumber
  actor U as 利用者
  participant B as ブラウザ
  participant R as demo-app（RP）
  participant A as auth（OP）

  U->>B: demo-app で「auth でログイン」を押す
  B->>R: GET /login
  R-->>B: 302 → auth の /authorize（新しい state、nonce、code_challenge）
  B->>A: GET /authorize（auth のセッションの Cookie が付く）
  Note over A: auth のセッションが生きている。同意も記録済み。ログイン画面も同意画面も出さない
  A-->>B: 302 → demo-app の /callback（code、state）
  Note over B,R: 以下、ログインの図の 10〜14 と同じ
```

利用者から見ると、「auth でログイン」を押した瞬間に、demo-app にログインした状態で戻ってくる。auth の画面は一瞬も見えない。

### /userinfo（アクセストークンで呼ぶ API）

```mermaid
sequenceDiagram
  autonumber
  participant R as demo-app（RP）
  participant A as auth（OP）
  participant DB as MySQL（auth）

  R->>A: GET /userinfo（Authorization: Bearer アクセストークン）
  A->>DB: アクセストークン（の SHA-256）から、利用者と scope を引く
  Note over A: 期限内か。scope に openid があるか
  A-->>R: sub、preferred_username（scope の profile による）
```

#### 図「/userinfo」とコードの対応

| 手順 | 図の中身 | コード |
| --- | --- | --- |
| /userinfo 1 | GET /userinfo（Bearer） | [src/routes/oidc.ts](../../src/routes/oidc.ts) の `GET /userinfo`。`Authorization: Bearer` がなければ 401 |
| /userinfo 2 | トークンから利用者と scope を引く | `access_tokens` と `users` を結合して、トークンの SHA-256 で引く |
| /userinfo 2 のあとの Note | 期限、scope | 期限切れ・不明は 401 `invalid_token`（`WWW-Authenticate: Bearer error="invalid_token"`）、openid がなければ 403 `insufficient_scope` |
| /userinfo 3 | sub、preferred_username | `c.json({ sub, preferred_username })`。sub は ID トークンと同じ値 |

ステップ4では、アクセストークンを「DB で引く乱数」にする（セッション ID と同じ形）。ステップ5で、JWT にして API が自分で検証する形（DB を引かない）と比べる。

## 5. 実装

### 決めること

| 項目 | 案 | 理由 |
| --- | --- | --- |
| ID トークンの署名の方式 | ES256（P-256） | ステップ3で検証した方式と同じ。鍵も署名も短い |
| 署名の秘密鍵の置き場所 | Terraform で作って Vault に置き、デプロイで環境変数に渡す（TOTP の鍵と同じ） | ステップ2で決めた形をそのまま使う。鍵の入れ替えは、JWKS に新旧の両方を載せれば止めずにできる（今回は作らない） |
| JWT の作り方 | 自分で書く（ヘッダー・中身の base64url、`crypto.sign`） | ステップ3で署名の検証を書いたので、作る側も小さい。ライブラリ（`jose`）は使わない |
| client の登録 | 管理用のコマンド（`admin create-client demo-app http://localhost:4000/callback`）。client_secret は一度だけ表示し、DB にはハッシュを置く | 利用者と同じ方針。登録の画面は作らない |
| demo-app の RP の実装 | ステップ4では、検証を自分で書く（Discovery、JWKS、署名、iss・aud・exp・nonce） | RP が何を確かめるかを見るため。ステップ5で独立したリポジトリ（ひな形）にするとき、ライブラリ（`openid-client`）に置き換えるかを決める |
| demo-app の置き場所 | このリポジトリの `demo-app/`（別の Hono のアプリ、ポート 4000、DB なし） | ステップ5で独立させるまでの仮住まい |
| 同意画面 | 作る。記録して、2回目からは出さない | 自分のアプリ同士なら省けるが、学ぶために作る |

### テーブル

| テーブル | 中身 |
| --- | --- |
| `oauth_clients` | `id`（client_id）、`secret_hash`（client_secret の SHA-256）、`name`（同意画面に出す名前）、`redirect_uris`（登録した URL。完全一致で照らす）、`created_at` |
| `authorization_codes` | `code_hash`（SHA-256）、`client_id`、`user_id`、`redirect_uri`、`scope`、`code_challenge`、`nonce`、`amr`、`auth_time`、`expires_at`（60秒） |
| `oauth_consents` | `user_id`、`client_id`、`scope`、`created_at` |
| `access_tokens` | `token_hash`（SHA-256）、`client_id`、`user_id`、`scope`、`expires_at`（ステップ4。ステップ5で見直す） |

- client_secret はセッション ID と同じく十分長い乱数なので、遅いハッシュ（Argon2id）は要らない。SHA-256 で足りる。
- `auth_time` は、利用者が auth で実際にログインした時刻（セッションを作った時刻）。SSO で2回目に来たときは、新しいログインではないので、最初の時刻のまま入る。

### 実装の小分け

| | 中身 |
| --- | --- |
| 4-a | 署名の鍵（Vault）、JWT を作る関数、`/jwks.json`、`/.well-known/openid-configuration` |
| 4-b | client の登録（管理用のコマンド）、`/authorize`（照合、ログイン画面への寄り道と戻り、同意画面）、認可コード |
| 4-c | `/token`（client の認証、コード、PKCE、ID トークン、アクセストークン）、`/userinfo` |
| 4-d | demo-app（`/login`、`/callback`、検証、セッション、トップの画面に ID トークンの中身）。手元で通しで試す |
| 4-e | 本番に載せ、手元の demo-app から本番の auth でログインする（demo-app は localhost のまま） |
