/**
 * 后端调用的券码查询脚本
 * 用法: node get_coupon_info.js <orderViewId> <token> <userid> <csecuuid> <openId> <openIdCipher>
 */

const fs = require('fs');
const vm = require('vm');

// 加载 mtgsig.js
const mtgsigPath = require('path').join(__dirname, 'mtgsig.js');
const code = fs.readFileSync(mtgsigPath, 'utf-8');

const sandbox = {
    console,
    fetch: global.fetch,
    Headers: global.Headers,
    Request: global.Request,
    Response: global.Response,
    URL,
    URLSearchParams,
    Buffer,
    module: { exports: {} },
    exports: {},
    require: () => ({}),
    setTimeout,
    clearTimeout
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'mtgsig.js', timeout: 15000 });

// 获取命令行参数
const args = process.argv.slice(2);
if (args.length < 3) {
    console.error('参数不足');
    process.exit(1);
}

const orderViewId = args[0];
const token = args[1];
const userid = args[2];
const csecuuid = args[3] || '';
const openId = args[4] || '';
const openIdCipher = args[5] || '';

// 调用函数
async function main() {
    try {
        const result = await sandbox.get_mt_order_rebate_info(orderViewId, token, userid, {
            csecuuid,
            openId,
            openIdCipher
        });
        console.log(JSON.stringify(result));
    } catch (error) {
        console.error(JSON.stringify({ error: true, message: error.message }));
    }
}

main();
