// 管理用のコマンド。登録の画面の代わりに、サーバーの上で叩く
//   手元：npx tsx --env-file=local.env src/admin.ts create-user alice
//   本番：docker compose exec app node dist/admin.js create-user alice
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { users } from './db/schema.js';
import { hashPassword } from './password.js';

// パスワードを、画面に出さずに読む。端末でなければ（パイプで渡されたら）1行読む
async function readPassword(prompt: string): Promise<string> {
	const stdin = process.stdin;
	if (!stdin.isTTY) {
		let data = '';
		for await (const chunk of stdin) data += chunk;
		return data.split('\n')[0];
	}
	process.stdout.write(prompt);
	stdin.setRawMode(true);
	stdin.setEncoding('utf8');
	let input = '';
	return new Promise((resolve) => {
		const onData = (ch: string) => {
			if (ch === '\r' || ch === '\n') {
				stdin.setRawMode(false);
				stdin.pause();
				stdin.off('data', onData);
				process.stdout.write('\n');
				resolve(input);
			} else if (ch === '\u0003') {
				process.exit(130); // Ctrl+C
			} else if (ch === '\u007f') {
				input = input.slice(0, -1); // Backspace
			} else {
				input += ch;
			}
		};
		stdin.on('data', onData);
	});
}

async function createUser(username: string) {
	const [existing] = await db.select().from(users).where(eq(users.username, username));
	if (existing) throw new Error(`user "${username}" already exists`);

	const password = await readPassword('password: ');
	// NIST SP 800-63B：文字種の強制はせず、長さだけを求める
	if (password.length < 12) throw new Error('password must be at least 12 characters');

	const id = randomUUID();
	await db.insert(users).values({ id, username, passwordHash: await hashPassword(password) });
	console.log(`created user "${username}" (id ${id})`);
}

const [command, ...args] = process.argv.slice(2);
try {
	if (command === 'create-user' && args[0]) await createUser(args[0]);
	else {
		console.error('usage: admin create-user <username>');
		process.exitCode = 1;
	}
} catch (e) {
	console.error((e as Error).message);
	process.exitCode = 1;
} finally {
	await pool.end();
}
