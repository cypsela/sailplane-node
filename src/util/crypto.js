'use strict'
const b64 = require('base64-js')
const secp256k1 = require('secp256k1')
const all = require('it-all')
const { combineChunks } = require('./buffer')

const sharedCrypter = (Crypter) => async (publicKey, privateKey) => {
  const secret = secp256k1.ecdh(publicKey, privateKey)
  const cryptoKey = await Crypter.importKey(secret.buffer)
  return Crypter.create(cryptoKey)
}

async function encryptContent (Crypter, content) {
  const cryptoKey = await Crypter.generateKey()
  const crypter = Crypter.create(cryptoKey)
  const contentBuf = await combineChunks(content)
  const { cipherbytes, iv } = await crypter.encrypt(contentBuf.buffer)
  const rawKey = await Crypter.exportKey(cryptoKey)
  return {
    cipherbytes: new Uint8Array(cipherbytes),
    rawKey: b64.fromByteArray(new Uint8Array(rawKey)),
    iv: b64.fromByteArray(new Uint8Array(iv))
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

module.exports = {
  sharedCrypter,
  encryptContent,
  catCid,
  verifyPub,
  compressedPub
}
