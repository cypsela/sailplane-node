'use strict'

module.exports = {
  cids: require('./cids'),
  crypto: require('./crypto'),
  buffer: require('./buffer'),
  ipfsAddConfig: { pin: false, wrapWithDirectory: false },
  removeSlash: (path) => path.slice(path.startsWith('/') ? 1 : 0),
  sortFn: (a, b) => a.toLowerCase().localeCompare(b.toLowerCase())
}
