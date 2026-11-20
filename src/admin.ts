// 管理用のコマンド。登録の画面の代わりに、サーバーの上で叩く
//   手元：npx tsx --env-file=local.env src/admin.ts create-user alice
//   本番：docker compose exec app node dist/admin.js create-user alice
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, pool } from './db/client.js';
import { oauthClients, users } from './db/schema.js';
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

// NIST SP 800-63B：文字種の強制はせず、長さだけを求める
async function readNewPassword() {
	const password = await readPassword('password: ');
	if (password.length < 12) throw new Error('password must be at least 12 characters');
	return password;
}

async function createUser(username: string) {
	const [existing] = await db.select().from(users).where(eq(users.username, username));
	if (existing) throw new Error(`user "${username}" already exists`);

	const password = await readNewPassword();
	const id = randomUUID();
	await db.insert(users).values({ id, username, passwordHash: await hashPassword(password) });
	console.log(`created user "${username}" (id ${id})`);
}

// 失敗の回数による一時停止を解く
async function unlockUser(username: string) {
	const [result] = await db.update(users).set({ failedCount: 0, lockedUntil: null }).where(eq(users.username, username));
	if (result.affectedRows === 0) throw new Error(`user "${username}" not found`);
	console.log(`unlocked user "${username}"`);
}

// パスワードを設定し直す。パスキーだけの利用者が端末を全部なくしたときの回復の手段（ステップ3-c）。
// 設定したパスワードは、利用者に別の経路（対面など）で渡す。ログインしたら、新しいパスキーを登録してもらう
async function setPassword(username: string) {
	const password = await readNewPassword();
	const [result] = await db
		.update(users)
		.set({ passwordHash: await hashPassword(password), failedCount: 0, lockedUntil: null })
		.where(eq(users.username, username));
	if (result.affectedRows === 0) throw new Error(`user "${username}" not found`);
	console.log(`set password for "${username}"`);
}

// メールアドレスを設定する（ステップ9）。ID トークンの email クレームになり、Access などの RP はこれで利用者を見分ける。
// ここで入れたアドレスは email_verified: true として出すので、本人のものだと確かめてから入れる。
// 「-」を渡すと消す。ほかの利用者が使っているアドレスは、列の重複不可の制約で断られる
async function setEmail(username: string, email: string) {
	const value = email === '-' ? null : email.trim().toLowerCase();
	// 形だけ見る（@ が1つ、前後が空でない、空白を含まない）。届くかどうかは見ない
	if (value !== null && (!/^[^\s@]+@[^\s@]+$/.test(value) || value.length > 254)) throw new Error(`not an email address: ${email}`);
	const [existing] = value ? await db.select({ username: users.username }).from(users).where(eq(users.email, value)) : [];
	if (existing && existing.username !== username) throw new Error(`email is already used by "${existing.username}"`);
	const [result] = await db.update(users).set({ email: value }).where(eq(users.username, username));
	if (result.affectedRows === 0) throw new Error(`user "${username}" not found`);
	console.log(value ? `set email of "${username}" to ${value}` : `removed email of "${username}"`);
}

// RP（client）を登録する（ステップ4）。client_secret はここで一度だけ表示する。DB には SHA-256 だけを置くので、なくしたら登録し直す
//   例：admin create-client demo-app http://localhost:4000/callback "デモのアプリ"
// --secret-stdin：secret をここで作らず、標準入力から1行読む（表示もしない）。共通基盤に載せる client 用で、
// secret は client の側の Terraform が作って Vault に置き、app VM の上で流し込む（sample-auth-client の scripts/register-client.sh）。
// 登録済みなら、secret と redirect_uri を合わせ直す（何度流してもよい）
async function createClient(id: string, redirectUri: string, name: string, secretFromStdin: boolean) {
	const url = new URL(redirectUri); // 形が URL でなければ、ここで止まる
	if (url.hash) throw new Error('redirect_uri must not contain a fragment');
	if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('redirect_uri must be https (or http://localhost)');
	const [existing] = await db.select().from(oauthClients).where(eq(oauthClients.id, id));
	if (existing && !secretFromStdin) throw new Error(`client "${id}" already exists`);

	const secret = secretFromStdin ? await readStdinLine() : randomBytes(32).toString('base64url');
	if (secret.length < 32) throw new Error('client_secret must be at least 32 characters');
	const secretHash = createHash('sha256').update(secret).digest('hex');
	const redirectUris = JSON.stringify([redirectUri]);
	if (existing) {
		await db.update(oauthClients).set({ secretHash, name, redirectUris }).where(eq(oauthClients.id, id));
		console.log(`updated client "${id}"`);
	} else {
		await db.insert(oauthClients).values({ id, secretHash, name, redirectUris });
		console.log(`created client "${id}"`);
	}
	console.log(`  redirect_uri:  ${redirectUri}`);
	if (!secretFromStdin) console.log(`  client_secret: ${secret}   <- shown only once`);
}

async function readStdinLine(): Promise<string> {
	if (process.stdin.isTTY) throw new Error('--secret-stdin needs the secret on stdin (pipe it in)');
	let data = '';
	for await (const chunk of process.stdin) data += chunk;
	return data.split('\n')[0].trim();
}

const [command, ...rest] = process.argv.slice(2);
const secretFromStdin = rest.includes('--secret-stdin');
const args = rest.filter((a) => a !== '--secret-stdin');
try {
	if (command === 'create-user' && args[0]) await createUser(args[0]);
	else if (command === 'unlock' && args[0]) await unlockUser(args[0]);
	else if (command === 'set-password' && args[0]) await setPassword(args[0]);
	else if (command === 'set-email' && args[1]) await setEmail(args[0], args[1]);
	else if (command === 'create-client' && args[1]) await createClient(args[0], args[1], args[2] ?? args[0], secretFromStdin);
	else {
		console.error('usage: admin create-user <username> | unlock <username> | set-password <username> | set-email <username> <email|-> | create-client [--secret-stdin] <client_id> <redirect_uri> [name]');
		process.exitCode = 1;
	}
} catch (e) {
	console.error((e as Error).message);
	process.exitCode = 1;
} finally {
	await pool.end();
}
