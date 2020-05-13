
'use strict'

const FSStore = require('orbit-db-fsstore')
const SharedFS = require('./SharedFS')

const ipfsKey = '_ipfs'

class SailplaneNode {
  constructor (orbitdb, options = {}) {
    this._orbitdb = orbitdb
    this.options = options

    if (!this._orbitdb[ipfsKey]) {
      throw new Error('cannot find ipfs node in orbitdb instance')
    }

    this.orbitdb.constructor.addDatabaseType(FSStore.type, FSStore)

    this.mounted = {}
  }

  static create (orbitdb, options = {}) {
    return new SailplaneNode(orbitdb, options)
  }

  async determineAddress (name, options) {
    return this.orbitdb.determineAddress(name, FSStore.type, options)
  }

  async mount (address, options = {}) {
    if (this.mounted[address]) return this.mounted[address]
    const db = await this.orbitdb.open(address, options)
    const sharedFS = SharedFS.create(db, this._orbitdb[ipfsKey], options)

    this.mounted[address] = sharedFS
    return sharedFS
  }
}

module.exports = SailplaneNode
