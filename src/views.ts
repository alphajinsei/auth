// 画面。html`...` は埋め込んだ値を自動でエスケープする（ユーザー名に <script> が入っていても、文字として出る）
import { html } from 'hono/html';

const layout = (title: string, body: unknown) => html`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - auth</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`;

export const loginPage = (error?: string, username = '') =>
	layout(
		'ログイン',
		html`
    ${error ? html`<p class="error">${error}</p>` : ''}
    <form method="post" action="/login">
      <label>ユーザー名 <input name="username" value="${username}" autocomplete="username" required autofocus></label>
      <label>パスワード <input name="password" type="password" autocomplete="current-password" required></label>
      <button>パスワードでログイン</button>
    </form>`,
	);

export const accountPage = (username: string) =>
	layout(
		'アカウント',
		html`
    <p>ログイン中：<strong>${username}</strong></p>
    <form method="post" action="/logout">
      <button>ログアウト</button>
    </form>`,
	);
