import test from 'node:test'
import assert from 'node:assert/strict'
import { filterGiftOrders } from './giftOrderList.js'

const orders = [
  { orderid: '1001', title: '火锅套餐', showstatus: '待使用', catename: '美食团购' },
  { orderid: '1002', title: '电影票', showstatus: '已完成', catename: '休闲娱乐' },
  { orderid: '1003', title: '咖啡礼物', showstatus: '礼物待领取', catename: '美食' }
]

test('queries all-order results by order number, title and status', () => {
  assert.deepEqual(filterGiftOrders(orders, '1002').map((item) => item.orderid), ['1002'])
  assert.deepEqual(filterGiftOrders(orders, '咖啡').map((item) => item.orderid), ['1003'])
  assert.deepEqual(filterGiftOrders(orders, '已完成').map((item) => item.orderid), ['1002'])
})
