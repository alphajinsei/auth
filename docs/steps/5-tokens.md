# ステップ5：アクセストークンとリフレッシュトークン

最終更新：2026-11-18

背景は [番外編：アクセストークンとリフレッシュトークンの来歴](../history/5-tokens.md)。ステップ4では、アクセストークンを「DB を引く乱数」にし、期限（1時間）が切れたらログインし直すしかなかった。このステップでは、来歴の 10 節の「今の形」を小さく作る。

- アクセストークンを JWT（RFC 9068 の形）にし、`/userinfo` が DB を引かずに確かめる
- リフレッシュトークンを出し、期限が切れたアクセストークンを、ログインし直さずに出し直す
- リフレッシュトークンを使うたびに取り替え、使用済みのものが来たら盗難と見なして系統ごと取り消す
- demo-app のログアウトで、リフレッシュトークンを取り消す

ロードマップのステップ5のうち、残りの2つ（demo-app を独立したリポジトリにする、認可モデル）は、この文書のあとの節として、あとで足す。

## この文書の読み方

| 節 | 中身 |
| --- | --- |
| 1. 技術の要素 | アクセストークンとリフレッシュトークンを、8つの要素に分ける。以下の節は、この番号で読む |
| 2. 登場人物 | 用語の表。ステップ4からの変化 |
| 3. 仕組みの補足 | 表だけでは分かりにくいところ（opaque と JWT の比べ方、系統と2つの期限、取り消しが効く範囲） |
| 4. 流れ | シーケンス図（API を呼ぶ、期限切れとリフレッシュ、盗難の検知、ログアウトと取り消し） |
| 5. 実装 | 決めること、テーブル、小分け |

番号の書き分けはステップ4と同じ。1 の表の ①〜⑧ は**要素**、4 の図の番号は**手順**（矢印）。コードのコメントでは「要素③」「リフレッシュ 5」「リフレッシュ 5 のあとの Note」と書く。図とコードの対応の表は、実装のあとに足す。

## 1. 技術の要素：8つの組み合わせ

| # | 要素 | 何を保証するか | 由来 |
| --- | --- | --- | --- |
| ① | **短命のアクセストークン** | 盗まれても、使えるのは期限（5分）まで。取り消しの確認を省ける代わりの歯止め | OAuth WRAP（2009年） |
| ② | **値の形（JWT、`typ: at+jwt`）** | 誰の、どの client の、どの scope の、いつまでの許可かを、auth が書いて署名する。`typ` で ID トークンと取り違えさせない | JWT（RFC 7519）、RFC 9068（2021年） |
| ③ | **API が手元で確かめる** | `/userinfo` は、署名（JWKS と同じ鍵）、iss、aud、exp、scope を計算だけで確かめる。トークンの表を引かない | RFC 9068 の 4 節 |
| ④ | **リフレッシュトークン（opaque、認可サーバーにだけ見せる）** | 長生きの許可は、auth の `/token` にだけ、client の認証付きで出す。API には一度も見せない | OAuth WRAP、RFC 6749 の 6 節 |
| ⑤ | **使うたびの判断のし直し** | リフレッシュのたびに、auth が記録を引いて、取り消されていないか、利用者と同意がまだあるかを確かめる | RFC 6749 の 6 節 |
| ⑥ | **取り替え（rotation）** | リフレッシュのたびに新しいリフレッシュトークンを出し、使ったものは使用済みにする | RFC 9700（2025年、BCP 240） |
| ⑦ | **使用済みの検知（系統ごとの取り消し）** | 使用済みのリフレッシュトークンが来たら、盗まれたと見なし、同じログインから続く系統を全部取り消す | RFC 9700 の 4.14.2 |
| ⑧ | **取り消しの口（`/revoke`）** | ログアウトのときに、client が「このリフレッシュトークンを無効にして」と頼める | RFC 7009（2013年） |

- **API を呼ぶ** ＝ demo-app が ② をヘッダーに付ける → auth の `/userinfo` が ③ で確かめる（① の期限内なら通る）
- **リフレッシュ** ＝ ① が切れた → demo-app が ④ を client の認証付きで `/token` へ → auth が ⑤ で判断し直し、⑥ で取り替えて、新しい ② と ④ を返す
- **盗難** ＝ 使用済みの ④ が来た → ⑦ で系統ごと取り消す
- **ログアウト** ＝ demo-app が ⑧ で ④ を取り消す。② は期限まで残る（① の短さで補う）

ステップ4の要素と比べると、⑥⑦ は認可コードの「一度きりで、異常に気づける」（ステップ4の要素④）を、長生きのトークンに広げたもの。③ は demo-app が ID トークンを確かめた手順（ステップ4の要素⑧）を、API の側でやるもの。

## 2. 登場人物

| 名前 | 何か | このリポジトリでは |
| --- | --- | --- |
| 認可サーバー（OP） | トークンを出し、リフレッシュと取り消しを受ける | auth の `/token`、`/revoke` |
| API（リソースサーバー） | アクセストークンを受けて、利用者のデータを返す | auth の `/userinfo`。同じ auth の中にあるが、このステップでは「auth の DB のトークンの表を見ない、別の API」のつもりで書く |
| client | トークンを受け取り、API を呼ぶ | demo-app（client_secret を持つ、confidential client） |
| アクセストークン | API を呼ぶ許可証 | ステップ4：32バイトの乱数、DB に SHA-256、1時間 → ステップ5：JWT（ES256、`typ: at+jwt`）、DB に置かない、5分 |
| リフレッシュトークン | アクセストークンを出し直す券 | 32バイトの乱数、DB に SHA-256。1本の期限 14日、系統の期限 30日 |
| 系統（family） | 1回のログイン（認可コードの引き換え）から、取り替えで続くリフレッシュトークンの並び | `family_id`（乱数）でまとめる |
| aud（アクセストークンの） | どの API 宛てか | auth の issuer（`https://auth.alphajinsei.com`）。API が auth の中にしかないので。ID トークンの aud（client_id）とは違う値になる |

## 3. 仕組みの補足

### opaque と JWT を、どう比べるか

ステップ4の opaque のアクセストークンを、ステップ5で JWT に替える。比べるのは、`/userinfo` が要求を受けたときに何をするか。

| | ステップ4（opaque） | ステップ5（JWT） |
| --- | --- | --- |
| トークンを確かめる | `access_tokens` を SHA-256 で引く | 署名、iss、aud、exp、scope を計算で確かめる。表を引かない |
| 利用者のデータを返す | `users` を結合して引く | `users` を sub で引く（ユーザー名は今の値を返したいので、ここは DB を引く） |
| 取り消し | 行を消せば、次の要求から効く | 効かない。期限（5分）まで通る |
| DB が落ちたら | トークンを確かめられない | トークンは確かめられる（データは返せない） |

`/userinfo` は利用者のデータを返す API なので、結局 `users` は引く。違いが出るのは「トークンを確かめる」の行だけ。API がトークンの確認のためだけに DB を引く必要がなくなる、というのが JWT の得で、データを持たない API（たとえば、scope だけ見て計算する API）なら、DB にまったく触れずに済む。

### 系統と、2つの期限

リフレッシュトークンには、期限を2つ持たせる（来歴の記事の勉強メモ「リフレッシュトークンもアクセストークンと同じ周期になるのか」）。

| 期限 | 数え始め | 取り替えで | 意味 |
| --- | --- | --- | --- |
| 1本の期限（14日） | そのリフレッシュトークンを出したとき | 新しいものは、そこから数え直す | 14日使わなければ、ログインし直し |
| 系統の期限（30日） | 最初のログイン（認可コードの引き換え） | 延びない | 使い続けていても、30日でログインし直し |

新しいリフレッシュトークンの期限は、「今から14日」と「系統の期限」の早いほう。

### 使用済みの行を残す理由

取り替えたあと、古いリフレッシュトークンの行を消すと、次に古いものが来たときに「知らないトークン」になり、盗難と区別できない。そこで、古い行は「使用済み」（`used_at`）の印を付けて残し、系統の期限が来たら掃除する。

- 知らないトークン：`invalid_grant` で断るだけ
- 使用済みのトークン：盗難と見なし、系統を全部消してから `invalid_grant`

### 取り消しが効く範囲

| 取り消す操作 | リフレッシュトークン | すでに出たアクセストークン（JWT） |
| --- | --- | --- |
| demo-app のログアウト（`/revoke`） | 系統ごと、すぐ効く | 期限（5分）まで通る |
| 盗難の検知 | 系統ごと、すぐ効く | 期限まで通る |
| 利用者が同意を取り消す（今は画面がない） | 次のリフレッシュで断られる | 期限まで通る |

アクセストークンを5分にしたのは、この「期限まで通る」の幅を小さくするため。demo-app の画面で期限切れとリフレッシュを確かめやすい長さでもある。

### 同時に2回リフレッシュしたら

demo-app が同じリフレッシュトークンで、ほぼ同時に2回リフレッシュすると、2回目は「使用済み」になり、盗難と見なして系統を消してしまう（正しい持ち主なのに、ログインし直しになる）。製品によっては、使用済みでも数秒以内なら許す猶予を設ける。今回は猶予を作らず、demo-app の側で同時に2回リフレッシュしない作りにする。

## 4. 流れ

### API を呼ぶ（アクセストークンが期限内）

```mermaid
sequenceDiagram
  autonumber
  participant R as demo-app（client）
  participant A as auth の /userinfo（API）
  participant DB as MySQL（auth）

  Note over R: セッションに、アクセストークン（JWT）、リフレッシュトークン、アクセストークンの期限を持っている
  R->>A: GET /userinfo（Authorization: Bearer アクセストークン）
  Note over A: ヘッダーの alg が ES256、typ が at+jwt か。kid の公開鍵で署名を確かめる
  Note over A: iss が auth、aud が auth、exp が期限内、scope に openid があるか。トークンの表は引かない
  A->>DB: sub で users を引く（ユーザー名の今の値）
  A-->>R: sub、preferred_username
```

ステップ4の図「/userinfo」との違いは、1 のあとの2つの Note（DB を引かずに確かめる）と、2 で引くのが `users` だけになったこと。

#### 図「API を呼ぶ」とコードの対応

| 手順 | 図の中身 | コード |
| --- | --- | --- |
| API 1 | GET /userinfo（Bearer） | [src/routes/oidc.ts](../../src/routes/oidc.ts) の `GET /userinfo`。`Authorization: Bearer` がなければ 401 `invalid_token` |
| API 1 のあとの 1つ目の Note | typ、kid、署名 | [src/access-token.ts](../../src/access-token.ts) の `verifyAccessToken`。typ が `at+jwt` でなければ断る（ID トークンの持ち込み）。署名は [src/jwt.ts](../../src/jwt.ts) の `verifyJwt`（alg が ES256 かも見る） |
| API 1 のあとの 2つ目の Note | iss、aud、exp、scope | 同じ関数で iss・aud（どちらも auth の issuer）・exp。外れたら 401 `invalid_token`。scope に openid がなければ、`/userinfo` が 403 `insufficient_scope` |
| API 2 | users を引く | `users` を sub で引く（ユーザー名の今の値）。利用者が消えていたら 401 |
| API 3 | sub、preferred_username | `c.json({ sub, preferred_username })`。preferred_username は scope に profile があるときだけ |

- アクセストークンは [src/access-token.ts](../../src/access-token.ts) の `issueAccessToken` が作る（`/token` から呼ぶ）。中身は iss、sub、aud、client_id、scope、iat、exp（5分）、jti。ヘッダーは `typ: at+jwt`。
- エラーの文面は `WWW-Authenticate` にそのまま入るので、相手が送った値（typ、alg など）を文面に混ぜない。混ぜると、引用符や制御文字でヘッダーが壊れる（試したら 500 になった）。

### 期限切れとリフレッシュ

auth は1つのプログラムだが、ここでは2つの役で出てくる。`/userinfo` は **API（リソースサーバー）**としての auth で、アクセストークンを受ける。`/token` は**認可サーバー**としての auth で、リフレッシュトークンを受ける。図では2本の線に分ける。API がよそのサーバーにあっても、流れは同じ（1〜2 と 8〜9 の宛先が、そのサーバーになるだけ）。

```mermaid
sequenceDiagram
  autonumber
  participant R as demo-app（client）
  participant P as auth の /userinfo（API）
  participant A as auth の /token（認可サーバー）
  participant DB as MySQL（auth）

  R->>P: GET /userinfo（Bearer 期限切れのアクセストークン）
  Note over P: 署名は正しいが、exp が過ぎている
  P-->>R: 401 invalid_token（WWW-Authenticate: Bearer error="invalid_token"）
  R->>A: POST /token（grant_type=refresh_token、refresh_token、client_id と client_secret）。裏の通信
  Note over A: client を認証する（client_secret）
  A->>DB: リフレッシュトークン（の SHA-256）の行を引く
  Note over A: この client のものか。使用済みでないか。1本の期限と、系統の期限の内か
  A->>DB: 利用者と同意がまだあるか
  A->>DB: 古い行に「使用済み」を付ける。新しいリフレッシュトークンの行を、同じ系統で足す
  Note over A: 新しいアクセストークン（JWT）に署名する
  A-->>R: 新しいアクセストークン、新しいリフレッシュトークン
  Note over R: セッションの2つを入れ替える
  R->>P: GET /userinfo（Bearer 新しいアクセストークン）
  P-->>R: sub、preferred_username
```

- demo-app は、401 を受けてからリフレッシュする（図の流れ）。手元の期限（`expires_in` から計算）を見て、切れる前にリフレッシュする作りもあり、無駄な 401 が減る。demo-app は、期限切れの 401 を画面で見られるように、401 を受けてからにする。
- リフレッシュの返事に、ID トークンは入れない（OIDC Core 12.2 では入れてもよい）。demo-app が「誰か」を知るのはログインのときだけで十分なので。
- 4 のあとの Note か 5 のどれかが外れたら `invalid_grant`。demo-app は自分のセッションを消して、ログインし直してもらう。

#### 図「期限切れとリフレッシュ」とコードの対応

| 手順 | 図の中身 | コード（[src/routes/oidc.ts](../../src/routes/oidc.ts)） |
| --- | --- | --- |
| リフレッシュ 1〜2 | 期限切れで 401 | demo-app の `POST /call`（[demo-app/src/index.ts](../../demo-app/src/index.ts)）が `/userinfo` を呼ぶ。auth は `verifyAccessToken` が `expired` を投げて 401 |
| リフレッシュ 3 | POST /token（grant_type=refresh_token） | demo-app の `refresh`（同じセッションで同時に呼ばれたら、2回目は1回目の結果を待つ）。auth の `POST /token` が grant_type で分かれ、`refreshGrant` へ。client の認証はログインのときと同じ `authenticateClient` |
| リフレッシュ 4 | 行を引く | `refresh_tokens` を SHA-256 で引く。その前に、系統の期限が切れた行を掃除する |
| リフレッシュ 4 のあとの Note | client、使用済み、期限 | 知らない → `unknown refresh token`、別の client → `issued to another client`、使用済み → 図「盗難の検知」へ、1本の期限切れ → `expired`。どれも `invalid_grant` |
| リフレッシュ 5 | 利用者と同意 | `users` と `oauth_consents` を引く。なければ系統ごと消して `invalid_grant` |
| リフレッシュ 6 | 使用済みにし、新しい行を足す | `used_at` が空のときだけ書き換える（`affectedRows` が 1 でなければ、同時に来たもう1つが先に使った → 盗難と同じ扱い）。`issueRefreshToken` で同じ系統に足す。1本の期限は「今から14日」と系統の期限の早いほう |
| リフレッシュ 6 のあとの Note | 新しいアクセストークン | `issueAccessToken`（5-a） |
| リフレッシュ 7 | 新しい2つ | `{ access_token, token_type, expires_in, scope, refresh_token }`。ID トークンは入れない |
| リフレッシュ 7 のあとの Note | 2つを入れ替える | demo-app の `refresh` が `session.tokens` を入れ替え、使用済みになった方を `previousRefresh` に覚える（「盗難のまね」のボタンのためだけ） |
| リフレッシュ 8〜9 | もう一度 /userinfo | demo-app の `POST /call` が1回だけやり直し、sub がログインのときと同じかを確かめる。リフレッシュに失敗したら、demo-app のセッションを消して「ログインし直してください」 |

ログインのとき（図「ログイン」の 13、[ステップ4](4-oidc.md)）も、返事に `refresh_token` が加わった。`codeGrant` が新しい系統を始める（`family_id` は乱数、系統の期限は30日後）。

### 盗難の検知

攻撃者が、何かの方法でリフレッシュトークン RT1 と client_secret を手に入れたとする（client_secret がなければ、そもそも使えない。要素④）。

```mermaid
sequenceDiagram
  autonumber
  participant R as demo-app（client）
  participant X as 攻撃者
  participant A as auth の /token（認可サーバー）
  participant DB as MySQL（auth）

  R->>A: POST /token（refresh_token=RT1）
  A->>DB: RT1 を使用済みにし、RT2 を足す
  A-->>R: アクセストークン、RT2
  X->>A: POST /token（refresh_token=RT1）
  A->>DB: RT1 の行を引く
  Note over A: RT1 は使用済み。盗まれたと見なす
  A->>DB: RT1 の系統（RT1、RT2）を全部消す
  A-->>X: 400 invalid_grant
  R->>A: POST /token（refresh_token=RT2）
  A->>DB: RT2 の行を引く（もうない）
  A-->>R: 400 invalid_grant
  Note over R: セッションを消して、ログインし直してもらう
```

順番が逆（攻撃者が先に RT1 を使い、demo-app があとで RT1 を使う）でも、あとから来た方が「使用済み」を出すので、同じように系統が消える。どちらが盗んだ側かは auth には分からないので、両方を締め出す。正しい利用者はログインし直せばよく、攻撃者はログインできない。

#### 図「盗難の検知」とコードの対応

| 手順 | 図の中身 | コード（[src/routes/oidc.ts](../../src/routes/oidc.ts)） |
| --- | --- | --- |
| 盗難 1〜3 | 正しい持ち主のリフレッシュ | 図「期限切れとリフレッシュ」の 3〜7 と同じ |
| 盗難 4〜5 | 攻撃者が RT1 を出し、行を引く | 同じ `refreshGrant` |
| 盗難 5 のあとの Note | 使用済み | `row.usedAt` があれば `reuseDetected` |
| 盗難 6 | 系統を全部消す | `revokeFamily`（`family_id` で消す）。監査ログに `refresh_token_reuse_detected` |
| 盗難 7 | invalid_grant | `refresh token already used` |
| 盗難 8〜10 | 正しい持ち主の RT2 も通らない | 行がもうないので `unknown refresh token` |

手元で試した結果（client を1つ登録し、リフレッシュトークンの行を DB に直接入れて、curl で `/token` を呼んだ）：

| 試したこと | 結果 |
| --- | --- |
| RT1 でリフレッシュ | 200。新しいアクセストークン（`expires_in: 300`）と RT2。RT1 の行は使用済み、RT2 の行は14日後が期限 |
| 新しいアクセストークンで `/userinfo` | 200 |
| RT1 をもう一度（攻撃者のつもり） | `refresh token already used`。系統の行が0になった |
| RT2（正しい持ち主） | `unknown refresh token` |
| 1本の期限が切れた RT | `refresh token expired` |
| 同意を消してから | `user or consent no longer exists`。系統の行が0になった |
| 同じ RT で同時に2回 | 片方は 200、もう片方は `already used`。系統ごと消えた（3 節「同時に2回リフレッシュしたら」のとおり） |


### ログアウトと取り消し

```mermaid
sequenceDiagram
  autonumber
  actor U as 利用者
  participant B as ブラウザ
  participant R as demo-app（client）
  participant A as auth の /revoke（認可サーバー）
  participant DB as MySQL（auth）

  U->>B: 「ログアウト」を押す
  B->>R: POST /logout
  R->>A: POST /revoke（token=リフレッシュトークン、client_id と client_secret）。裏の通信
  Note over A: client を認証する。トークンがこの client のものか
  A->>DB: その系統を全部消す
  A-->>R: 200（知らないトークンでも 200）
  Note over R: 自分のセッションを消す
  R-->>B: トップへ（ログインしていない画面）
```

- `/revoke` は、知らないトークン（すでに消えた、期限切れ）でも 200 を返す（RFC 7009 の 2.2）。client がすることは「捨てた」で同じなので、エラーにしない。
- すでに出たアクセストークンは、期限（5分）まで `/userinfo` を通る。demo-app はセッションごと捨てるので、手元に残らない。
- auth のセッション（ブラウザの Cookie）は、ステップ4と同じく残る。もう一度「auth でログイン」を押すと、auth の画面を通らずに戻ってくる。

#### 図「ログアウトと取り消し」とコードの対応

| 手順 | 図の中身 | コード |
| --- | --- | --- |
| ログアウト 1〜2 | 「ログアウト」→ POST /logout | demo-app の `POST /logout`。Discovery の `revocation_endpoint` へ、リフレッシュトークンを送る |
| ログアウト 3 | POST /revoke（token、client の認証） | [src/routes/oidc.ts](../../src/routes/oidc.ts) の `POST /revoke`。client の認証は `/token` と同じ `authenticateClient`。Origin の確認からは外す（[src/origin.ts](../../src/origin.ts)。`/token` と同じ理由） |
| ログアウト 3 のあとの Note | この client のものか | 別の client のトークンなら 400 `invalid_grant`（RFC 7009 2.1）。アクセストークン（JWT。「.」を含む）なら 400 `unsupported_token_type`（取り消しても効かないので、「取り消せた」と誤解させない） |
| ログアウト 4 | 系統を全部消す | `revokeFamily`（5-b で盗難の検知に使ったものと同じ）。監査ログに `refresh_token_revoked` |
| ログアウト 5 | 200 | 本文なしの 200。知らないトークンでも 200 |
| ログアウト 6 | トップへ | demo-app がセッションを消す。`/revoke` が失敗しても（auth が落ちている、など）ログアウトは続ける |

手元で試した結果：

| 試したこと | 結果 |
| --- | --- |
| RT2 を取り消す | 200。系統の行（使用済みの RT1 と RT2）が0になった |
| 取り消した RT2 でリフレッシュ | `unknown refresh token` |
| そのときのアクセストークンで `/userinfo` | 200（期限まで通る。3 節「取り消しが効く範囲」のとおり） |
| もう一度取り消す | 200 |
| アクセストークンを取り消そうとする | 400 `unsupported_token_type` |
| `token` なし | 400 `invalid_request` |
| 別の client のトークン | 400 `invalid_grant`。行は残った |
| client_secret なし | 401 `invalid_client` |

## 5. 実装

### 決めること

| 項目 | 案 | 理由 |
| --- | --- | --- |
| アクセストークンの形 | JWT（RFC 9068）。ヘッダーは `alg: ES256`、`typ: at+jwt`、`kid`。中身は iss、sub、aud、client_id、scope、iat、exp、jti | 来歴の 6 節。`typ` を ID トークン（`JWT`）と分け、`/userinfo` は `at+jwt` 以外を断る |
| 署名の鍵 | ID トークンと同じ鍵（Vault の `OIDC_SIGNING_KEY`） | 鍵を増やさない。`typ` と aud で取り違えを防ぐ |
| aud | auth の issuer | API は auth の中の `/userinfo` だけ。API が増えたら、API ごとの識別子にする（RFC 8707 の resource） |
| アクセストークンの期限 | 5分 | 取り消しが効かない幅を小さくする。demo-app で期限切れを確かめやすい |
| `access_tokens` の表 | 消す（マイグレーション） | JWT にすると使わない。opaque の形は、ステップ4の文書とこの文書の 3 節に残す |
| リフレッシュトークンの形 | 32バイトの乱数。DB に SHA-256 | auth しか読まないので、中身を書く必要がない（来歴の 11 節） |
| リフレッシュトークンを出す相手 | client_secret を持つ client に、ログインのたびに | 今の client はすべて confidential。OIDC の `offline_access`（利用者がいないときも使う許可）の scope は作らない |
| 期限 | 1本 14日、系統 30日 | 3 節「系統と、2つの期限」 |
| 盗難の検知 | 使用済みが来たら、系統ごと消す。猶予は作らない | 3 節「同時に2回リフレッシュしたら」 |
| リフレッシュの返事 | アクセストークン、リフレッシュトークン、`expires_in`、scope。ID トークンは入れない | 4 節の図「期限切れとリフレッシュ」の下 |
| `/revoke` | リフレッシュトークンだけを受ける（アクセストークンは `unsupported_token_type` で断る）。系統ごと消す。知らないトークンでも 200 | アクセストークンは JWT で、取り消しても `/userinfo` は記録を見ないので意味がない |
| Discovery | `grant_types_supported` に `refresh_token`、`revocation_endpoint` を足す | client が口を見つけられるように |
| demo-app | セッションにトークンを持つ。トップに「/userinfo を呼ぶ」ボタン、アクセストークンの中身と期限。401 ならリフレッシュして1回だけやり直す。ログアウトで `/revoke` | 期限切れ、リフレッシュ、取り替えを画面で見られるように |

### テーブル

| テーブル | 中身 |
| --- | --- |
| `refresh_tokens`（足す） | `token_hash`（SHA-256、主キー）、`family_id`、`client_id`、`user_id`、`scope`、`expires_at`（1本の期限）、`family_expires_at`（系統の期限）、`used_at`（使用済みなら時刻）、`created_at` |
| `access_tokens`（消す） | ステップ4の opaque のアクセストークン |

- `family_id` に索引を張る（系統ごと消すため）。
- 掃除：`family_expires_at` を過ぎた行を、`/token` のたびに消す（ステップ4の認可コードと同じ形）。

### 実装の小分け

| | 中身 |
| --- | --- |
| 5-a | アクセストークンを JWT に（`signJwt` に `typ` を渡せるように）、`/userinfo` が手元で確かめる、`access_tokens` を消す |
| 5-b | `refresh_tokens`、ログインでリフレッシュトークンを出す、`grant_type=refresh_token`（取り替え、使用済みの検知）、Discovery |
| 5-c | `/revoke` |
| 5-d | demo-app：トークンをセッションに、「/userinfo を呼ぶ」、401 でリフレッシュ、ログアウトで `/revoke`。手元で通しで試す（期限切れ、盗難の検知も） |
| 5-e | 本番に載せる（マイグレーションが流れる。鍵や共通基盤は変えない） |

### 5-d：demo-app から通しで試す

demo-app の画面（トップ）に、アクセストークンの期限と中身、リフレッシュトークンの頭8文字、「/userinfo を呼ぶ」「盗難のまね：1つ前のリフレッシュトークンを出す」「ログアウト」のボタン、何が起きたかの記録を出す。

手元で試すとき（[README](../../README.md) の「手元での開発」）：

- demo-app は `npm run demo:local`。設定は `demo-app/local.env`（手元の auth に登録した client_secret。git に入らない）。本番を向く `demo-app/.env` とは分けた
- 期限切れを早く見るには、auth を `ACCESS_TOKEN_TTL_S=10` を付けて起動する（既定は5分。本番では設定しない）。auth は時計のずれを1分許すので、実際に 401 になるのは 10秒 ＋ 1分後

ブラウザ（Playwright）で通した結果（`ACCESS_TOKEN_TTL_S=10`）：

| 操作 | 記録（demo-app の画面） | auth の監査ログ |
| --- | --- | --- |
| ログイン | ログインした。アクセストークンとリフレッシュトークンを受け取った | `token_issued` |
| 「/userinfo を呼ぶ」（期限内） | /userinfo を呼んだ（200） | （なし。DB を引かない） |
| 75秒待って「/userinfo を呼ぶ」 | /userinfo が 401 を返した（`error_description="expired"`）→ リフレッシュした → /userinfo を呼んだ（200）。リフレッシュトークンの頭8文字が変わった | `token_refreshed` |
| 「盗難のまね」 | 400 invalid_grant refresh token already used | `refresh_token_reuse_detected` |
| 75秒待って「/userinfo を呼ぶ」 | 「リフレッシュできませんでした（invalid_grant）。ログインし直してください」。今のリフレッシュトークンも、系統ごと消えていた | `token_error`（unknown refresh token） |
| もう一度「auth でログイン」 | auth の画面を通らずに戻る（auth のセッションは残っている）。新しい系統 | `token_issued` |
| 「ログアウト」 | ログインしていない画面 | `refresh_token_revoked`。demo-app のリフレッシュトークンの行が0になった |

