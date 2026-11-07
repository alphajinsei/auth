import { int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core';

export const memos = mysqlTable('memos', {
	id: int('id').primaryKey().autoincrement(),
	text: text('text').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at'),
	tag: varchar('tag', { length: 64 }),
});
