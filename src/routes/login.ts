// ログイン・アカウント・ログアウト。流れ：docs/steps/1-password-session.md
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../password.js';
import { currentUser, endSession, startSession } from '../session.js';
import { accountPage, loginPage } from '../views.js';

export const login = new Hono();

// 連続して5回失敗したら15分止める。回数はログインに成功したときだけ0に戻すので、
// 期限が過ぎたあとも、また1回失敗すると止まる（総当たりの速さを、15分に1回まで落とす）
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

async function recordFailure(userId: string) {
	// 1つの UPDATE で数える（同時に何本も失敗が来ても、数え漏れない）。
	// MySQL の SET は左から順に評価され、右の式は足したあとの failed_count を見る
	const until = new Date(Date.now() + LOCK_MS);
	await db.execute(sql`
		UPDATE users
		SET failed_count = failed_count + 1,
		    locked_until = IF(failed_count >= ${MAX_FAILURES}, ${until}, locked_until)
		WHERE id = ${userId}`);
}

// 監査ログ（標準出力に1行の JSON。本番では docker compose logs で見る）
function audit(event: string, username: string) {
	console.log(JSON.stringify({ at: new Date().toISOString(), event, username }));
}

// 存在しないユーザー名のときに照らす、捨てのハッシュ（起動時に1回だけ作る）
const dummyHash = await hashPassword(randomBytes(16).toString('hex'));

login.get('/login', async (c) => {
	if (await currentUser(c)) return c.redirect('/account', 303);
	return c.html(loginPage());
});

login.post('/login', async (c) => {
	const body = await c.req.parseBody();
	const username = String(body.username ?? '');
	const password = String(body.password ?? '');

	const [user] = await db.select().from(users).where(eq(users.username, username));
	const fail = () => c.html(loginPage('ユーザー名かパスワードが違います', username), 401);

	// 利用者がいないとき・止めているときも、捨てのハッシュで同じだけ時間をかけてから断る。
	// 速く返すと、応答時間の差から「このユーザー名は存在する」「いま止まっている」と分かってしまう。
	// 止めている間は、本物のパスワードには照らさない（総当たりの途中で当たっても、当たったと分からないように）
	const locked = user?.lockedUntil != null && user.lockedUntil > new Date();
	if (!user || locked) {
		await verifyPassword(dummyHash, password);
		audit(user ? 'login_locked' : 'login_unknown_user', username);
		return fail(); // どの理由でも、画面には同じことしか言わない。理由はログにだけ残す
	}

	if (!(await verifyPassword(user.passwordHash, password))) {
		await recordFailure(user.id);
		audit('login_bad_password', username);
		return fail();
	}

	await db.update(users).set({ failedCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
	audit('login_ok', username);
	await startSession(c, user.id);
	// 303：POST の結果として、別の URL を GET で開き直させる（再読み込みでフォームが再送されない）
	return c.redirect('/account', 303);
});

login.get('/account', async (c) => {
	const user = await currentUser(c);
	if (!user) return c.redirect('/login', 303);
	return c.html(accountPage(user.username));
});

// GET にしない：<img src=".../logout"> を置くだけで、よそのサイトから勝手にログアウトさせられるため
login.post('/logout', async (c) => {
	await endSession(c);
	return c.redirect('/login', 303);
});
