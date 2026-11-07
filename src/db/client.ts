import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

// 接続情報は環境変数から（本番は deploy が Vault から取り出して .env に書く、手元は local.env と compose.override.yaml）
export const pool = mysql.createPool({
	host: process.env.DB_HOST,
	port: Number(process.env.DB_PORT ?? 3306),
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
	connectionLimit: 5,
	// 暗号化はするが、証明書は検証しない（HeatWave も手元の MySQL も自己署名の証明書）。経路は VCN の中
	ssl: { rejectUnauthorized: false },
});

export const db = drizzle(pool);
