
'use strict'

const Buffer = require('safe-buffer').Buffer
const b64 = require('base64-js')
const all = require('it-all')
const isBlob = require('is-blob')

const ipfsAddConfig = { pin: false, wrapWithDirectory: true }

const validCid = function (CID, cid) {
  try {
    return !!new CID(cid)
  } catch (e) {
    return false
  }
}

const readCid = (read) => read && read.cid

const sharedCrypter = (secp256k1, Crypter) => async (publicKey, privateKey) => {
  const secret = secp256k1.ecdh(publicKey, privateKey)
  const cryptoKey = await Crypter.importKey(secret.buffer)
  return Crypter.create(cryptoKey)
}

const combineChunks = async (content) => {
  let chunks = Buffer.from([])
  for await (const chunk of content) {
    chunks = Buffer.concat([chunks, chunk])
  }
  return chunks
}
const first = async (iter) => { for await (const f of iter) { return f } }

async function * encryptContent (Crypter, source, map) {
  for await (const item of source) {
    if (!item.content) {
      yield item
    } else {
      const cryptoKey = await Crypter.generateKey()
      const iv = await Crypter.generateIV()
      map.set(
        item.path[0] === '/' ? item.path.slice(1) : item.path,
        { cryptoKey, iv }
      )
      const crypter = Crypter.create(cryptoKey)

      let contentBuf
      if (typeof item.content === 'string') {
        contentBuf = Buffer.from(item.content)
      } else if (item.content[Symbol.iterator]) {
        if (item.content instanceof Uint8Array) {
          contentBuf = item.content
        } else if (await first(item.content) instanceof Uint8Array) {
          contentBuf = await combineChunks(item.content)
        } else if (await first(item.content) instanceof Number) {
          contentBuf = new Uint8Array(item.content)
        }
      } else if (item.content[Symbol.asyncIterator]) {
        contentBuf = await combineChunks(item.content)
      } else if (isBlob(item.content)) {
        contentBuf = new Uint8Array(await item.content.arrayBuffer())
      } else {
        throw new Error('source content not supported')
      }

      const { cipherbytes } = await crypter.encrypt(contentBuf.buffer, iv)

      yield { ...item, content: new Uint8Array(cipherbytes) }
    }
  }
}

async function catCid (ipfs, cid, { Crypter, key, iv }) {
  let contentBuf = await combineChunks(ipfs.cat(cid))

  if (Crypter && key && iv) {
    try {
      const cryptoKey = await Crypter.importKey(b64.toByteArray(key).buffer)
      const crypter = await Crypter.create(cryptoKey)
      iv = b64.toByteArray(iv)
      return new Uint8Array(await crypter.decrypt(contentBuf.buffer, iv))
    } catch (e) {
      console.error(e)
      return new Uint8Array()
    }
  } else {
    return contentBuf
  }
}

module.exports = {
  ipfsAddConfig,
  validCid,
  readCid,
  sharedCrypter,
  combineChunks,
  encryptContent,
  catCid
}
