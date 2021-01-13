'use strict'

const parseCid = (CID, cid) => new CID(cid)

const validCid = function (CID, cid) {
  try {
    return Boolean(new CID(cid))
  } catch (e) {
    return false
  }
}

const readCid = (read) => read && read.cid

module.exports = {
  parseCid,
  validCid,
  readCid
}
