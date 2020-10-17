
'use strict'

const Buffer = require('safe-buffer').Buffer
const b64 = require('base64-js')
const secp256k1 = require('secp256k1')
const all = require('it-all')

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
  let chunks = Buffer.from([])
  let i = 0
  for await (const chunk of content) {
    if (handleUpdate) handleUpdate(i, total)
    chunks = Buffer.concat([chunks, Buffer.from(chunk)])
    i++
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
    iv: new Uint8Array(iv),
    rawKey: new Uint8Array(rawKey)
  }
}

async function catCid (ipfs, cid, { Crypter, key, iv, handleUpdate } = {}) {
  const ipfsCat = ipfs.cat(cid)
  const [{ size }] = await all(ipfs.get(cid))
  const total = Math.round(size / 262171);
  let contentBuf = await combineChunks(ipfsCat, { handleUpdate , total })

  if (Crypter && key && iv) {
    try {
      const cryptoKey = await Crypter.importKey(b64.toByteArray(key).buffer)
      const crypter = await Crypter.create(cryptoKey)
      return new Uint8Array(await crypter.decrypt(contentBuf.buffer, b64.toByteArray(iv)))
    } catch (e) {
      console.error(`catCid failed: CID ${cid}`)
      console.error(e)
      return new Uint8Array()
    }
  } else {
    return contentBuf
  }
}

const verifyPub = (publicKeyBuf) => secp256k1.publicKeyVerify(publicKeyBuf)

const compressedPub = (publicKeyBuf) =>
  Buffer.from(secp256k1.publicKeyConvert(publicKeyBuf, true))

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
  compressedPub
}
