'use strict'
const b64 = require('base64-js')
const secp256k1 = require('secp256k1')

const sharedCrypter = (Crypter) => async (publicKey, privateKey) => {
  const secret = secp256k1.ecdh(publicKey, privateKey)
  const cryptoKey = await Crypter.importKey(secret.buffer)
  return Crypter.create(cryptoKey)
}

async function encryptContent (Crypter, buffer) {
  try {
    const cryptoKey = await Crypter.generateKey()
    const crypter = Crypter.create(cryptoKey)
    const { cipherbytes, iv } = await crypter.encrypt(buffer.buffer)
    return {
      cipherbytes: new Uint8Array(cipherbytes),
      key: b64.fromByteArray(new Uint8Array(await Crypter.exportKey(cryptoKey))),
      iv: b64.fromByteArray(new Uint8Array(iv))
    }
  } catch (e) {
    console.error('failed to encrypt content')
    console.error(e)
    return new Uint8Array()
  }
}

async function decryptContent (Crypter, buffer, { key, iv }) {
  try {
    const cryptoKey = await Crypter.importKey(b64.toByteArray(key).buffer)
    const crypter = await Crypter.create(cryptoKey)
    return new Uint8Array(await crypter.decrypt(buffer.buffer, b64.toByteArray(iv)))
  } catch (e) {
    console.error('failed to decrypt cipherbytes')
    console.error(e)
    return new Uint8Array()
  }
}

const verifyPub = (publicKeyBuf) => secp256k1.publicKeyVerify(publicKeyBuf)
const compressedPub = (publicKeyBuf) => secp256k1.publicKeyConvert(publicKeyBuf, true)

module.exports = {
  sharedCrypter,
  encryptContent,
  decryptContent,
  verifyPub,
  compressedPub
}
