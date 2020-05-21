
'use strict'

const map = require('it-map')
const last = require('it-last')

const errors = {
  pathExistNo: (path) => new Error(`path '${path}' does not exist`),
  pathExistYes: (path) => new Error(`path '${path}' already exists`),
  pathDirNo: (path) => new Error(`path '${path}' is not a directory`)
}

class SharedFS {
  constructor (db, ipfs, options = {}) {
    this._db = db
    this._ipfs = ipfs
    this.options = options

    this.address = this._db.address.bind(this._db)
    this.events = this._db.events.bind(this._db)

    this.joinPath = this._db.joinPath
    this.exists = this._db.exists
    this.content = this._db.content
    this.read = this._db.read
    this.tree = this._db.tree
    this.ls = this._db.ls

    this._onDbUpdate = () => this._getHash()

    this.running = false
    if (options.start !== false) this.start()
  }

  static create (db, ipfs, options) {
    return new SharedFS(db, ipfs, options)
  }

  async start () {
    if (this.running) { return }
    this._db.events.on('replicated', this._onDbUpdate)
    this._db.events.on('write', this._onDbUpdate)
    await this._db.load()
    this.running = true
  }

  async stop () {
    if (!this.running) { return }
    this._db.events.removeListener('replicated', this._onDbUpdate)
    this._db.events.removeListener('write', this._onDbUpdate)
    await this._db.close()
    this.running = false
  }

  async upload (path, name, source) {
    if (!this.content(path) !== 'dir') throw errors.pathDirNo(path)
    map(this._ipfs.add(source, { pin: false }), console.log)
  }

  async remove (path) {
    if (!this.exits(path)) throw errors.pathExistNo(path)
    this.content(path) === 'dir'
      ? this._db.rmdir(path)
      : this._db.rm(path)
  }

  async download (path) {
    if (!this.exists(path)) throw errors.pathExistNo(path)
    return this._ipfs.get(this._getHash(path))
  }

  async _getHash (path = '/r') {
    if (this.content(path) === 'file') {
      return this.read(path)
    }

    const dirHash = async (path) => {
      const dirStruct = this.ls(path)
        .filter((p) => this.content(p) === 'file')
        .reduce((arr, p) => [
          ...arr,
          {
            path: p.slice(path.length + 1),
            content: this._ipfs.cat(this.read(p))
          }
        ], [])
      return last(this._ipfs.add(dirStruct, { wrapWithDirectory: true }))
    }

    return dirHash(path)
  }
}

module.exports = SharedFS
