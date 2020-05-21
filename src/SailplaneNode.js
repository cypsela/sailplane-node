
'use strict'

const FSStore = require('@tabcat/orbit-db-fsstore')
const SharedFS = require('./SharedFS')

const ipfsKey = '_ipfs'

class SailplaneNode {
  constructor (orbitdb, options = {}) {
    this._orbitdb = orbitdb
    this.options = options

    this.mounted = {}

    if (!this._orbitdb[ipfsKey]) {
      throw new Error('cannot find ipfs node in orbitdb instance')
    }

    this._orbitdb.constructor.addDatabaseType(FSStore.type, FSStore)
  }

  static create (orbitdb, options = {}) {
    return new SailplaneNode(orbitdb, options)
  }

  async determineAddress (name, options) {
    return this._orbitdb.determineAddress(name, FSStore.type, options)
  }

  async mount (address, options = {}) {
    const db = await this._orbitdb.open(address, options)
    this.mounted[address] = SharedFS.create(db, this._orbitdb[ipfsKey], options)
    return this.mounted[address]
  }
}

module.exports = SailplaneNode
