
'use strict'

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

module.exports = {
  ipfsAddConfig,
  validCid,
  readCid,
  sharedCrypter
}
