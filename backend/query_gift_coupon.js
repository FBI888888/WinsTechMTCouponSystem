'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const TOKEN = 'AgHrJI7BeI9nlx55P82_3hK-3oU64ifxubiO6YLNHLArHvcqSYnGYUj-_XlowpfZbMTKQeZ8Oc6E9AAAAACsMwAAVrYv1ZMwTGZijB703pfh_oxg9SgcHNnFZNVAo3heS0gn10DUNUw3_w8vYS_lz8Yk';
const USERID = '4360236367';
const GIFT_ID = '19854399936561773906657';
const OPEN_ID = '';

function main() {
  const backendApiPath = path.join(__dirname, 'app', 'services', 'meituan', 'meituanBackendApi.cjs');
  const argsJson = JSON.stringify({
    token: TOKEN,
    orderId: String(GIFT_ID),
    options: {
      userId: String(USERID),
      openId: String(OPEN_ID),
    },
  });

  const result = spawnSync(process.execPath, [backendApiPath, 'getCouponList', argsJson], {
    encoding: 'utf8',
    timeout: 30000,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(result.stderr || 'query failed');
    process.exit(result.status || 1);
  }

  process.stdout.write(result.stdout);
}

main();
