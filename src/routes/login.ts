// ログイン・アカウント・ログアウト。流れ：docs/steps/1-password-session.md
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../password.js';
import { currentUser, endSession, startSession } from '../session.js';
import { accountPage, loginPage } from '../views.js';

export const login = new Hono();

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
	// 利用者がいなくても、同じだけ時間をかけて照らす。
	// いないときだけ速く返すと、応答時間の差から「このユーザー名は存在する」と分かってしまう
	const ok = await verifyPassword(user?.passwordHash ?? dummyHash, password);
	if (!user || !ok) {
		// どちらが違うかは言わない
		return c.html(loginPage('ユーザー名かパスワードが違います', username), 401);
	}

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
