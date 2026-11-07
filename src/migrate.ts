// まだ流していないマイグレーションを流す（流したものは DB の __drizzle_migrations テーブルに記録される）
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { db, pool } from './db/client.js';

await migrate(db, { migrationsFolder: './migrations' });
await pool.end();
console.log('migrations applied');
