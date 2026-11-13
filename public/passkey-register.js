// ブラウザ側（RP アプリケーション）。流れ：docs/steps/3-passkey.md の図「登録」
// 番号の読み方
//   「登録 7」   ＝ 図「登録」の 7 番の矢印（図の丸数字。Note には番号がないので「登録 7 のあとの Note」と書く）
//   「ログイン 7」＝ 図「ログイン」の 7 番の矢印
//   「要素③」   ＝ 「1. 技術の要素」の表の ③
// どの関数が図のどこに当たるかの一覧は、文書の各図の下の「図とコードの対応」の表
// サーバーとは JSON でやりとりする。JSON とバイト列の変換は、ブラウザの関数に任せる
//   options（JSON）→ parseCreationOptionsFromJSON → navigator.credentials.create → credential.toJSON()（JSON）
// 秘密鍵や指紋は、このコードからは見えない。触れるのは、認証器が返してきた公開鍵と署名だけ

const form = document.getElementById('passkey-register');
const message = document.getElementById('passkey-message');

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// 登録 1：「パスキーを登録」を押す
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  message.textContent = '';
  try {
    // 登録 2 → 登録 3：サーバーに challenge 入りの options を作ってもらう
    const options = await post('/account/passkey/options');
    // 登録 4 → 5 → 6：認証器に鍵ペアを作らせる（5 で指紋・PIN を求められる）。RP ID と今のページのドメインが合わなければ、ブラウザが断る
    const credential = await navigator.credentials.create({
      publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
    });
    // 登録 6 のあとの Note：ブラウザが clientDataJSON（種類・challenge・origin）を作って添えている
    // 登録 7：toJSON でまとめて base64url にし、サーバーへ送る。返事（登録 9）が来たら画面を読み直す
    await post('/account/passkey/verify', { credential: credential.toJSON(), name: form.elements.name.value });
    location.href = '/account?passkey=registered';
  } catch (err) {
    // 利用者が取り消した、登録済みの認証器だった、などは NotAllowedError / InvalidStateError で来る
    message.textContent =
      err.name === 'InvalidStateError' ? 'この認証器には、すでにパスキーが登録されています'
      : err.name === 'NotAllowedError' ? '取り消されたか、時間切れになりました'
      : err.message;
  }
});
