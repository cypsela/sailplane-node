'use strict'

module.exports = {
  crypto: require('./crypto'),
  buffer: require('./buffer'),
  ipfsAddConfig: { pin: false, wrapWithDirectory: false },
  removeSlash: (path) => path.slice(path.startsWith('/') ? 1 : 0),
  sortFn: (a, b) => a.toLowerCase().localeCompare(b.toLowerCase()),
  readCid: (read) => read && read.cid
}
