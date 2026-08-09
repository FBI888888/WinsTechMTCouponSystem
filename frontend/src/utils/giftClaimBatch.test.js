import test from 'node:test'
import assert from 'node:assert/strict'
import { runSequentialGiftBatch } from './giftClaimBatch.js'

test('runs gifts in order and waits one interval between requests', async () => {
  const calls = []
  const waits = []
  const result = await runSequentialGiftBatch({
    items: ['a', 'b', 'c'],
    execute: async (item) => calls.push(item),
    intervalMs: 1000,
    wait: async (ms) => waits.push(ms)
  })
  assert.deepEqual(calls, ['a', 'b', 'c'])
  assert.deepEqual(waits, [1000, 1000])
  assert.equal(result.reason, 'completed')
})

test('manual stop only prevents requests that have not started', async () => {
  const calls = []
  let stopped = false
  let stoppedAt = null
  const result = await runSequentialGiftBatch({
    items: ['a', 'b', 'c'],
    shouldStop: () => stopped,
    execute: async (item) => {
      calls.push(item)
      stopped = true
    },
    onStop: (index) => { stoppedAt = index },
    wait: async () => {}
  })
  assert.deepEqual(calls, ['a'])
  assert.equal(stoppedAt, 1)
  assert.equal(result.reason, 'stopped')
})

test('can stop after precheck before the current claim request is sent', async () => {
  const calls = []
  let stoppedAt = null
  const result = await runSequentialGiftBatch({
    items: ['a', 'b'],
    execute: async (item) => {
      calls.push(`precheck:${item}`)
      return { stop: true }
    },
    onStop: (index) => { stoppedAt = index },
    wait: async () => {}
  })
  assert.deepEqual(calls, ['precheck:a'])
  assert.equal(stoppedAt, 0)
  assert.equal(result.reason, 'stopped')
})

test('pause decision preserves the current result and does not start later gifts', async () => {
  for (const category of ['limit', 'self_gift', 'risk']) {
    const calls = []
    let pauseFrom = null
    const result = await runSequentialGiftBatch({
      items: ['a', 'b', 'c'],
      execute: async (item) => {
        calls.push(item)
        return item === 'a' ? { pause: true, category } : { pause: false }
      },
      onPause: (index) => { pauseFrom = index },
      wait: async () => {}
    })
    assert.deepEqual(calls, ['a'])
    assert.equal(pauseFrom, 1)
    assert.equal(result.reason, 'paused')
  }
})

test('unavailable and unknown results continue to the next gift', async () => {
  const calls = []
  await runSequentialGiftBatch({
    items: ['unavailable', 'unknown', 'success'],
    execute: async (item) => {
      calls.push(item)
      return { pause: false }
    },
    wait: async () => {}
  })
  assert.deepEqual(calls, ['unavailable', 'unknown', 'success'])
})
