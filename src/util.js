
'use strict'

const ipfsAddConfig = { pin: false, wrapWithDirectory: true }

const validCid = function (CID, cid) {
  try {
    return !!new CID(cid)
  } catch (e) {
    return false
  }
}

module.exports = {
  ipfsAddConfig,
  validCid
}
