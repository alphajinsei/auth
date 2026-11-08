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
	createdAt: timestamp('created_at').notNull().defaultNow(),
});
