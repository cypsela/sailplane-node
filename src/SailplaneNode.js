
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

    if (!orbitdb.constructor.getDatabaseTypes()[FSStore.type]) {
      orbitdb.constructor.addDatabaseType(FSStore.type, FSStore)
    }
  }

  static async create (orbitdb, options = {}) {
    return new SailplaneNode(orbitdb, options)
  }

  async stop () {
    await Promise.all(
      Object.keys(this.mounted)
        .map(async (k) => {
          await this.mounted[k].stop()
          delete this.mounted[k]
        })
    )
  }

  async determineAddress (name, options) {
    return this._orbitdb.determineAddress(name, FSStore.type, options)
  }

  async mount (address, options = {}) {
    address = address.toString()
    const db = await this._orbitdb.open(address, options)
    options.onStop = () => { delete this.mounted[address] }
    this.mounted[address] = await SharedFS.create(db, this._orbitdb[ipfsKey], options)
    return this.mounted[address]
  }
}

module.exports = SailplaneNode
