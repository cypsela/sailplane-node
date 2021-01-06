
'use strict'

const b64 = require('base64-js')
const secp256k1 = require('secp256k1')
const all = require('it-all')
const concatUint8 = require('uint8arrays/concat')

const ipfsAddConfig = { pin: false, wrapWithDirectory: false }

const removeSlash = (path) => path.slice(path.startsWith('/') ? 1 : 0)

const sortFn = (o, t) => o.toLowerCase().localeCompare(t.toLowerCase())

const validCid = function (CID, cid) {
  try {
    return !!new CID(cid)
  } catch (e) {
    return false
  }
}

const readCid = (read) => read && read.cid

const sharedCrypter = (Crypter) => async (publicKey, privateKey) => {
  const secret = secp256k1.ecdh(publicKey, privateKey)
  const cryptoKey = await Crypter.importKey(secret.buffer)
  return Crypter.create(cryptoKey)
}

const combineChunks = async (content, { handleUpdate, total } = {}) => {
  let chunks = Uint8Array.from([])
  for await (const chunk of content) {
    chunks = concatUint8([chunks, chunk])
    if (handleUpdate) handleUpdate(chunks.length, total)
  }
  return chunks
}

async function encryptContent (Crypter, content) {
  const cryptoKey = await Crypter.generateKey()
  const crypter = Crypter.create(cryptoKey)
  const contentBuf = await combineChunks(content)
  const { cipherbytes, iv } = await crypter.encrypt(contentBuf.buffer)
  const rawKey = await Crypter.exportKey(cryptoKey)
  return {
    cipherbytes: new Uint8Array(cipherbytes),
    iv: b64.fromByteArray(new Uint8Array(iv)),
    rawKey: b64.fromByteArray(new Uint8Array(rawKey))
  }
}

async function catCid (ipfs, cid, { Crypter, key, iv, handleUpdate } = {}) {
  const [{ size: total }] = await all(ipfs.get(cid))
  const contentBuf = await combineChunks(ipfs.cat(cid), { handleUpdate , total })

  if (!Crypter || !key || !iv) return contentBuf

  try {
    const cryptoKey = await Crypter.importKey(b64.toByteArray(key).buffer)
    const crypter = await Crypter.create(cryptoKey)
    return new Uint8Array(await crypter.decrypt(contentBuf.buffer, b64.toByteArray(iv)))
  } catch (e) {
    console.error(`catCid failed: CID ${cid}`)
    console.error(e)
    return new Uint8Array()
  }
}

const verifyPub = (publicKeyBuf) => secp256k1.publicKeyVerify(publicKeyBuf)

const compressedPub = (publicKeyBuf) => secp256k1.publicKeyConvert(publicKeyBuf, true)

const buf2hex = (ab) => ab.reduce((hex, byte) => hex + ('00' + byte.toString(16)).slice(-2), '')
const hex2buf = (hex) => Uint8Array.from(hex.match(/.{2}/g).map(h => parseInt(h, 16)))

module.exports = {
  ipfsAddConfig,
  removeSlash,
  sortFn,
  validCid,
  readCid,
  sharedCrypter,
  combineChunks,
  encryptContent,
  catCid,
  verifyPub,
  compressedPub,
  buf2hex,
  hex2buf
}
