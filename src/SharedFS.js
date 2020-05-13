
'use strict'

class SharedFS {
  constructor (db, ipfs, options = {}) {
    this.db = db
    this._ipfs = ipfs
    this.options = options

    this.address = this.db.address.bind(this.db)
    this.events = this.db.events.bind(this.db)
    this.combinedPath = this.db.combinedPath
    this.tree = this.db.tree.bind(this.db)
    this.ls = this.db.ls.bind(this.db)
  }

  static create (db, ipfs, options) {
    return new SharedFS(db, ipfs, options)
  }

  async upload () {}

  async remove () {}
}

module.exports = SharedFS
