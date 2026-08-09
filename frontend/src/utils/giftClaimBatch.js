export async function runSequentialGiftBatch({
  items,
  execute,
  onStart = () => {},
  onStop = () => {},
  onPause = () => {},
  shouldStop = () => false,
  intervalMs = 1000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  for (let index = 0; index < items.length; index++) {
    if (shouldStop()) {
      onStop(index)
      return { reason: 'stopped', nextIndex: index }
    }

    const item = items[index]
    onStart(item, index)
    const decision = await execute(item, index)
    if (decision?.stop) {
      onStop(index)
      return { reason: 'stopped', nextIndex: index }
    }
    if (decision?.pause) {
      onPause(index + 1, decision)
      return { reason: 'paused', nextIndex: index + 1, decision }
    }

    if (shouldStop()) {
      onStop(index + 1)
      return { reason: 'stopped', nextIndex: index + 1 }
    }
    if (index < items.length - 1) await wait(intervalMs)
  }
  return { reason: 'completed', nextIndex: items.length }
}
