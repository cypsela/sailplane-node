'use strict'
const concatUint8 = require('uint8arrays/concat')

const buf2hex = (ab) => ab.reduce((hex, byte) => hex + ('00' + byte.toString(16)).slice(-2), '')
const hex2buf = (hex) => Uint8Array.from(hex.match(/.{2}/g).map(h => parseInt(h, 16)))

const combineChunks = async (content, { handleUpdate, total } = {}) => {
  let chunks = Uint8Array.from([])
  for await (const chunk of content) {
    chunks = concatUint8([chunks, chunk])
    if (handleUpdate) handleUpdate(chunks.length, total)
  }
  return chunks
}

module.exports = {
  buf2hex,
  hex2buf,
  combineChunks
}
