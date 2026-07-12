'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const backendApiPath = path.join(__dirname, 'meituanBackendApi.cjs');

function main() {
  const [orderViewId, token, userid, csecuuid = '', openId = ''] = process.argv.slice(2);

  if (!orderViewId || !token || !userid) {
    console.error(JSON.stringify({ error: true, message: 'Usage: node get_coupon_info.js <orderViewId> <token> <userid> [csecuuid] [openId]' }));
    process.exit(1);
  }

  const argsJson = JSON.stringify({
    token,
    orderId: String(orderViewId),
    options: {
      userId: String(userid),
      openId: String(openId),
      uuid: String(csecuuid || ''),
      platform: 'android',
    },
  });

  const result = spawnSync(process.execPath, [backendApiPath, 'getCouponList', argsJson], {
    encoding: 'utf8',
    timeout: 30000,
  });

  if (result.error) {
    console.error(JSON.stringify({ error: true, message: result.error.message }));
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(result.stderr || JSON.stringify({ error: true, message: 'backend api process failed' }));
    process.exit(result.status || 1);
  }

  process.stdout.write(result.stdout);
}

main();
