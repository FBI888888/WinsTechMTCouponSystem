import test from 'node:test'
import assert from 'node:assert/strict'
import { accountToCredential, accountToElectronPayload, parseMeituanTokenLink } from './meituanCredential.js'

test('parses userId and token from a temporary link without persisting the URL', () => {
  const result = parseMeituanTokenLink(
    'https://i.meituan.com/path?userId=123456&token=abc%2Bdef%3D',
    'windows'
  )
  assert.deepEqual(result, {
    kind: 'temporary',
    userid: '123456',
    token: 'abc+def=',
    platform: 'windows'
  })
})

test('requires a platform and both credential fields', () => {
  assert.throws(
    () => parseMeituanTokenLink('https://i.meituan.com/?userId=1&token=x', ''),
    /平台/
  )
  assert.throws(
    () => parseMeituanTokenLink('https://i.meituan.com/?token=x', 'android'),
    /userId/
  )
})

test('maps a saved account to an Electron credential', () => {
  const result = accountToCredential({
    id: 8,
    userid: '42',
    token: 'token',
    platform: 'ios',
    open_id: 'openid',
    csecuuid: 'uuid'
  })
  assert.equal(result.kind, 'saved')
  assert.equal(result.accountId, 8)
  assert.equal(result.platform, 'ios')
  assert.equal(result.openId, 'openid')
})

test('maps complete native account identity without substituting defaults', () => {
  const result = accountToCredential({
    id: 9,
    userid: '105',
    token: 'native-token',
    platform: 'windows',
    credential_source: 'native',
    open_id: 'native-open',
    open_id_cipher: 'native-open-cipher',
    union_id: 'native-union',
    union_id_cipher: 'native-union-cipher',
    login_uuid: 'native-uuid'
  })
  assert.equal(result.credentialSource, 'native')
  assert.equal(result.openIdCipher, 'native-open-cipher')
  assert.equal(result.unionId, 'native-union')
  assert.equal(result.unionIdCipher, 'native-union-cipher')
  assert.equal(result.uuid, 'native-uuid')

  const electron = accountToElectronPayload({
    userid: '105',
    token: 'native-token',
    platform: 'windows',
    credential_source: 'native',
    open_id: 'native-open',
    open_id_cipher: 'native-open-cipher',
    union_id: 'native-union',
    union_id_cipher: 'native-union-cipher',
    login_uuid: 'native-uuid'
  })
  assert.equal(electron.credentialSource, 'native')
  assert.equal(electron.unionIdCipher, 'native-union-cipher')
})
