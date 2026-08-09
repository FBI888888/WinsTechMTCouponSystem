const test = require('node:test')
const assert = require('node:assert/strict')

const MeituanAPI = require('./meituanAPI.cjs')


test('legacy credentials use per-field values before compatibility defaults', () => {
  const result = MeituanAPI.resolveAccountRequestOptions({
    credentialSource: 'legacy',
    openId: 'account-open-id',
    uuid: '',
  })
  assert.equal(result.openId, 'account-open-id')
  assert.equal(result.uuid, MeituanAPI.LEGACY_REQUEST_PROFILE.uuid)
  assert.equal(result.finger, MeituanAPI.LEGACY_REQUEST_PROFILE.finger)
})


test('native credentials never inherit another identity from legacy defaults', () => {
  const result = MeituanAPI.resolveAccountRequestOptions({
    credentialSource: 'native',
    openId: 'native-open-id',
    uuid: '',
    finger: '',
  })
  assert.equal(result.openId, 'native-open-id')
  assert.equal(result.uuid, '')
  assert.equal(result.finger, '')

  const headers = MeituanAPI.applyAccountCredentialHeaders({}, {
    openId: result.openId,
    openIdCipher: 'native-open-cipher',
    unionId: 'native-union',
    unionIdCipher: 'native-union-cipher',
    uuid: 'native-uuid'
  })
  assert.equal(headers.openidcipher, 'native-open-cipher')
  assert.equal(headers.unionidcipher, 'native-union-cipher')
  assert.equal(headers.csecuuid, 'native-uuid')
})
