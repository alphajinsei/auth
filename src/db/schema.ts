import { bigint, datetime, index, int, mysqlTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/mysql-core';

// 利用者。登録の画面はなく、管理用のコマンド（src/admin.ts）で作る
export const users = mysqlTable('users', {
	// UUID。外に見せる利用者の ID（ステップ4で OIDC の sub になる）。連番にしないのは、人数や登録順を推測させないため
	id: varchar('id', { length: 36 }).primaryKey(),
	username: varchar('username', { length: 64 }).notNull().unique(),
	// Argon2id のハッシュ。アルゴリズム・パラメータ・ソルトも中に入っている（$argon2id$v=19$m=...,t=...,p=...$ソルト$ハッシュ）
	// 空ならパスワードなし（パスキーだけのアカウント。ステップ3-c）
	passwordHash: varchar('password_hash', { length: 255 }),
	// 連続して失敗した回数と、止めている期限（ステップ1-c）
	failedCount: int('failed_count').notNull().default(0),
	lockedUntil: datetime('locked_until'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ログイン中のセッション。Cookie に入れる ID そのものは置かず、その SHA-256 だけを置く
export const sessions = mysqlTable('sessions', {
	idHash: varchar('id_hash', { length: 64 }).primaryKey(), // SHA-256 の16進
	userId: varchar('user_id', { length: 36 })
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: datetime('expires_at').notNull(),
	// password：パスワードまで済んだ仮のセッション（6桁を待っている）。full：本物のセッション
	stage: varchar('stage', { length: 16 }).notNull().default('full'),
	// このログインで実際に使った認証の方式（OIDC の amr と同じ値。RFC 8176）。空白区切り。例：'pwd'、'pwd otp'
	amr: varchar('amr', { length: 64 }).notNull().default('pwd'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

// 利用者に登録した TOTP（1人に1つ）。アカウント（users）とは分け、「登録した認証の手段」として持つ
export const totpCredentials = mysqlTable('totp_credentials', {
	userId: varchar('user_id', { length: 36 })
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	// 秘密（20バイト）を AES-256-GCM で暗号化したもの（src/secretbox.ts）
	secret: varchar('secret', { length: 255 }).notNull(),
	// 確認の6桁が通った時刻。空なら確認待ち（まだログインには使わない）
	confirmedAt: datetime('confirmed_at'),
	// 最後に通った時刻の枠の番号。これ以前の枠は拒む（同じ6桁の再利用の防止）
	lastStep: int('last_step'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

// 利用者に登録したパスキー（1人に複数）。流れ：docs/steps/3-passkey.md
// サーバーに置くのは公開鍵だけ。漏れても、攻撃者が使えるものはない
export const webauthnCredentials = mysqlTable('webauthn_credentials', {
	// 鍵の ID（認証器が作る。base64url）。ログインのとき、どの鍵で署名したかをこれで知らせてくる
	id: varchar('id', { length: 512 }).primaryKey(),
	userId: varchar('user_id', { length: 36 })
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	// 公開鍵。認証器が渡してきた COSE（CBOR）の形のまま、base64url で置く。検証のときに Node.js の鍵に直す
	publicKey: text('public_key').notNull(),
	// 署名のたびに認証器が増やす数（同期されるパスキーは 0 のまま）。最大 2^32-1 なので bigint
	signCount: bigint('sign_count', { mode: 'number', unsigned: true }).notNull().default(0),
	// 鍵がどう届くか（usb、nfc、ble、internal、hybrid）。登録済みの一覧として渡すときに添える
	transports: varchar('transports', { length: 255 }),
	name: varchar('name', { length: 64 }).notNull(), // 「iPhone」などの表示用
	createdAt: timestamp('created_at').notNull().defaultNow(),
	lastUsedAt: datetime('last_used_at'),
});

// 発行した challenge（5分。一度使ったら消す）。Cookie には乱数の ID を入れ、ここにはその SHA-256 を置く（セッションと同じ形）
export const webauthnChallenges = mysqlTable('webauthn_challenges', {
	idHash: varchar('id_hash', { length: 64 }).primaryKey(),
	challenge: varchar('challenge', { length: 64 }).notNull(), // 32バイトの乱数の base64url
	purpose: varchar('purpose', { length: 16 }).notNull(), // register / login
	// 登録のときだけ：誰のための challenge か（発行したときのログイン中の利用者）
	userId: varchar('user_id', { length: 36 }).references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: datetime('expires_at').notNull(),
});

// ---- OIDC（ステップ4）。流れ：docs/steps/4-oidc.md ----

// 登録した RP（client）。管理用のコマンド（admin create-client）で作る
export const oauthClients = mysqlTable('oauth_clients', {
	id: varchar('id', { length: 64 }).primaryKey(), // client_id
	// client_secret の SHA-256（16進）。secret は登録のときに一度だけ表示し、ここには置かない
	secretHash: varchar('secret_hash', { length: 64 }).notNull(),
	name: varchar('name', { length: 64 }).notNull(), // 同意画面に出す名前
	// 登録した redirect_uri（JSON の配列）。/authorize と /token で、完全一致で照らす（要素②）
	redirectUris: text('redirect_uris').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

// 認可コード（60秒、一度きり。要素④）。/authorize で決まったことを全部ここに結び付け、/token で引き換える
export const authorizationCodes = mysqlTable('authorization_codes', {
	codeHash: varchar('code_hash', { length: 64 }).primaryKey(), // コードの SHA-256。コードそのものは置かない
	clientId: varchar('client_id', { length: 64 })
		.notNull()
		.references(() => oauthClients.id, { onDelete: 'cascade' }),
	userId: varchar('user_id', { length: 36 })
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	redirectUri: varchar('redirect_uri', { length: 512 }).notNull(),
	scope: varchar('scope', { length: 255 }).notNull(),
	codeChallenge: varchar('code_challenge', { length: 64 }).notNull(), // PKCE（要素⑥）。SHA-256 の base64url は43文字
	nonce: varchar('nonce', { length: 255 }), // 要素⑨。ID トークンにそのまま入れる
	amr: varchar('amr', { length: 64 }).notNull(), // セッションの amr を写す
	authTime: datetime('auth_time').notNull(), // 利用者が auth で実際にログインした時刻（セッションを作った時刻）
	expiresAt: datetime('expires_at').notNull(),
});

// 同意の記録（要素③）。同じ利用者・同じ client で、求める scope が記録の範囲に収まれば、同意画面を出さない
export const oauthConsents = mysqlTable(
	'oauth_consents',
	{
		userId: varchar('user_id', { length: 36 })
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		clientId: varchar('client_id', { length: 64 })
			.notNull()
			.references(() => oauthClients.id, { onDelete: 'cascade' }),
		scope: varchar('scope', { length: 255 }).notNull(), // 同意した scope（空白区切り）
		createdAt: timestamp('created_at').notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.userId, t.clientId] })],
);

// アクセストークンの表（access_tokens）は、ステップ5で消した。アクセストークンは JWT になり、DB に置かない（docs/steps/5-tokens.md）

// リフレッシュトークン（ステップ5の要素④〜⑦。docs/steps/5-tokens.md）。乱数を Cookie のセッション ID と同じく SHA-256 で置く
// 系統（family）：1回のログイン（認可コードの引き換え）から、取り替えで続く並び。盗難を見つけたら、系統ごと消す
export const refreshTokens = mysqlTable(
	'refresh_tokens',
	{
		tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
		familyId: varchar('family_id', { length: 22 }).notNull(), // 16バイトの乱数の base64url
		clientId: varchar('client_id', { length: 64 })
			.notNull()
			.references(() => oauthClients.id, { onDelete: 'cascade' }),
		userId: varchar('user_id', { length: 36 })
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		scope: varchar('scope', { length: 255 }).notNull(),
		expiresAt: datetime('expires_at').notNull(), // 1本の期限（14日。ただし系統の期限を超えない）
		familyExpiresAt: datetime('family_expires_at').notNull(), // 系統の期限（最初のログインから30日。取り替えても延びない）
		// 使用済みなら、使った時刻。取り替えたあとも行を残すのは、もう一度来たときに「知らない」と「使用済み（盗難）」を見分けるため
		usedAt: datetime('used_at'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
	},
	(t) => [index('refresh_tokens_family_idx').on(t.familyId)],
);
