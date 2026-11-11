import { datetime, int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

// 利用者。登録の画面はなく、管理用のコマンド（src/admin.ts）で作る
export const users = mysqlTable('users', {
	// UUID。外に見せる利用者の ID（段4で OIDC の sub になる）。連番にしないのは、人数や登録順を推測させないため
	id: varchar('id', { length: 36 }).primaryKey(),
	username: varchar('username', { length: 64 }).notNull().unique(),
	// Argon2id のハッシュ。アルゴリズム・パラメータ・ソルトも中に入っている（$argon2id$v=19$m=...,t=...,p=...$ソルト$ハッシュ）
	passwordHash: varchar('password_hash', { length: 255 }).notNull(),
	// 連続して失敗した回数と、止めている期限（段1-c）
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
