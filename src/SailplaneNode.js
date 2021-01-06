
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
    if (!orbitdb.constructor.databaseTypes.includes(FSStore.type)) {
      orbitdb.constructor.addDatabaseType(FSStore.type, FSStore)
    }
  }

  static async create (orbitdb, options = {}) {
    return new SailplaneNode(orbitdb, options)
  }

  async stop () {
    await Promise.all(
      Object.values(this.mounted).map(m => m.stop())
    )
  }

  async determineAddress (name, options) {
    return this._orbitdb.determineAddress(name, FSStore.type, options)
  }

  async mount (address, options = {}) {
    address = address.toString()
    const fsstore = await this._orbitdb.open(address, options)
    if (fsstore.type !== FSStore.type) throw new Error(`address type doesn't match ${FSStore.type}`)
    this.mounted[address] = await SharedFS.create(fsstore, this._orbitdb[ipfsKey], options)
    this.mounted[address].events.once('stop', () => { delete this.mounted[address] })
    return this.mounted[address]
  }
}

module.exports = SailplaneNode
