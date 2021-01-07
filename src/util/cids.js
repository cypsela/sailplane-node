'use strict'

const parseCid = function (CID, cid) {
  try {
    return new CID(cid)
  } catch (e) {
    return undefined
  }
}

const validCid = (CID, cid) => Boolean(parseCid(CID, cid))

const readCid = (read) => read && read.cid

module.exports = {
  parseCid,
  validCid,
  readCid
}
