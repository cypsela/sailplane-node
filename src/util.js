
'use strict'

const Buffer = require('safe-buffer').Buffer
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
  const crypter = await this.Crypter.create(cryptoKey)
}

async function * encryptContent (Crypter, source, map) {
  for await (const item of source) {
    if (!item.content) { yield item }

    const cryptoKey = await Crypter.generateKey()
    map.set(item.path[0] === '/' ? item.path.slice(1) : item.path, cryptoKey)
    const crypter = Crypter.create(cryptoKey)

    let contentBuf
    if (typeof item.content === 'string') {
      contentBuf = Buffer.from(item.content)
    } else if (item.content[Symbol.iterator] || item.content[Symbol.asyncIterator]) {
      // may not handle Iterable<Uint8Array | Number>
      contentBuf = new Uint8Array(await all(item.content))
    } else if (isBlob(item.content)) {
      contentBuf = new Uint8Array(await item.content.arrayBuffer())
    }

    const encryptedContent = await crypter.encrypt(contentBuf.buffer)

    yield { ...item, content: encryptedContent }
  }
}

module.exports = {
  ipfsAddConfig,
  validCid,
  readCid,
  sharedCrypter,
  encryptContent
}
