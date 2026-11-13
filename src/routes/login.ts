// ログイン・アカウント・ログアウト。流れ：docs/steps/1-password-session.md
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { totpCredentials, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../password.js';
import { open } from '../secretbox.js';
import { currentUser, endSession, pendingUser, startSession } from '../session.js';
import { verifyTotp } from '../totp.js';
import { accountPage, loginPage, totpLoginPage } from '../views.js';
import { listPasskeys } from './passkey.js';

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

	// TOTP を登録（確認済み）していれば、仮のセッションにして6桁の画面へ（段2の図「ログイン」）。
	// 失敗の回数は、ここではまだ0に戻さない。戻すと「パスワードを通して回数を0に戻し、6桁を4回試す」を
	// くり返せて、6桁を無制限に試せてしまう。ログインが最後まで済んだときにだけ戻す
	const [cred] = await db.select().from(totpCredentials).where(eq(totpCredentials.userId, user.id));
	if (cred?.confirmedAt) {
		audit('login_password_ok_totp_required', username);
		await startSession(c, user.id, 'password', 'pwd');
		return c.redirect('/login/totp', 303);
	}

	await db.update(users).set({ failedCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
	audit('login_ok', username);
	await startSession(c, user.id, 'full', 'pwd');
	// 303：POST の結果として、別の URL を GET で開き直させる（再読み込みでフォームが再送されない）
	return c.redirect('/account', 303);
});

// ---- 2要素目：TOTP の6桁（段2の図「ログイン」の後半） ----

login.get('/login/totp', async (c) => {
	if (!(await pendingUser(c))) return c.redirect('/login', 303);
	return c.html(totpLoginPage());
});

login.post('/login/totp', async (c) => {
	const pending = await pendingUser(c);
	if (!pending) return c.redirect('/login', 303); // 仮のセッションが切れた（5分）か、ない
	const code = String((await c.req.parseBody()).code ?? '');
	const fail = () => c.html(totpLoginPage('6桁が違います'), 401);

	const [user] = await db.select().from(users).where(eq(users.id, pending.id));
	const [cred] = await db.select().from(totpCredentials).where(eq(totpCredentials.userId, pending.id));
	if (!user || !cred?.confirmedAt) return c.redirect('/login', 303);

	// パスワードと同じ回数で止める。止めている間は、6桁を照らさない
	if (user.lockedUntil && user.lockedUntil > new Date()) {
		audit('login_locked', user.username);
		return fail();
	}

	const step = verifyTotp(open(cred.secret, user.id), code, cred.lastStep);
	if (step === null) {
		await recordFailure(user.id);
		audit('login_bad_totp', user.username);
		return fail();
	}

	// 「最後に使った枠」を、今より前の値のときだけ書き換える。同じ6桁で同時に2つのリクエストが来ても、
	// 書き換えに成功するのは1つだけ（読んでから書くと、両方が通ってしまう）
	const [result] = await db.execute(sql`
		UPDATE totp_credentials SET last_step = ${step}
		WHERE user_id = ${user.id} AND (last_step IS NULL OR last_step < ${step})`);
	if ((result as unknown as { affectedRows: number }).affectedRows !== 1) {
		audit('login_totp_reused', user.username);
		return fail();
	}

	await db.update(users).set({ failedCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
	audit('login_ok', user.username);
	// 仮のセッションを捨て、新しい ID で本物のセッションを作る（権限が上がる瞬間に ID を作り直す）
	await startSession(c, user.id, 'full', 'pwd otp');
	return c.redirect('/account', 303);
});

login.get('/account', async (c) => {
	const user = await currentUser(c);
	if (!user) return c.redirect('/login', 303);
	// 登録した TOTP の状態（行がない／確認待ち／有効）
	const [cred] = await db.select().from(totpCredentials).where(eq(totpCredentials.userId, user.id));
	const totp = !cred ? 'none' : cred.confirmedAt ? 'enabled' : 'pending';
	const passkeys = await listPasskeys(user.id);
	const notices: Record<string, string> = {
		'totp=enabled': 'TOTP を有効にしました',
		'totp=deleted': 'TOTP を削除しました',
		'passkey=registered': 'パスキーを登録しました',
	};
	const [key] = Object.entries(c.req.query()).map(([k, v]) => `${k}=${v}`);
	return c.html(accountPage(user.username, user.amr, totp, passkeys, notices[key ?? '']));
});

// GET にしない：<img src=".../logout"> を置くだけで、よそのサイトから勝手にログアウトさせられるため
login.post('/logout', async (c) => {
	await endSession(c);
	return c.redirect('/login', 303);
});
