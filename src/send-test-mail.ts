// 試しに1通送る：docker compose exec app node dist/send-test-mail.js <宛先>
// Web の API にはしない（誰でもメールを送らせられる口になる）
import { from, transport } from './mail.js';

const to = process.argv[2];
if (!to) {
	console.error('usage: node dist/send-test-mail.js <to>');
	process.exit(1);
}

const info = await transport.sendMail({
	from,
	to,
	subject: 'sample-oci-vm-docker からのテスト',
	text: `app VM のコンテナから mail VM を通して送りました（${new Date().toISOString()}）。`,
});
console.log(`sent: ${info.messageId} ${info.response}`);
