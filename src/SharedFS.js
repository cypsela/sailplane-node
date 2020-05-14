
'use strict'

class SharedFS {
  constructor (db, ipfs, options = {}) {
    this._db = db
    this._ipfs = ipfs
    this.options = options

    this.address = this._db.address.bind(this._db)
    this.events = this._db.events.bind(this._db)
    this.combinedPath = this._db.combinedPath
    this.tree = this._db.tree.bind(this._db)
    this.ls = this._db.ls.bind(this._db)
  }

  static create (db, ipfs, options) {
    return new SharedFS(db, ipfs, options)
  }

  async upload () {}

  async remove () {}
}

module.exports = SharedFS
