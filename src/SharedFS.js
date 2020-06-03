
'use strict'

const { default: PQueue } = require('p-queue')
const all = require('it-all')
const last = require('it-last')

const errors = {
  pathExistNo: (path) => new Error(`path '${path}' does not exist`),
  pathExistYes: (path) => new Error(`path '${path}' already exists`),
  pathDirNo: (path) => new Error(`path '${path}' is not a directory`)
}

const defaultOptions = {
  autoStart: true,
  load: true,
  onStop: function () {}
}

class SharedFS {
  constructor (db, ipfs, options = {}) {
    this._db = db
    this._ipfs = ipfs
    this.options = { ...defaultOptions, ...options }

    this.address = this._db.address
    this.events = this._db.events

    this.fs = {}
    this.fs.joinPath = this._db.joinPath
    this.fs.exists = this._db.exists
    this.fs.content = this._db.content
    this.fs.read = this._db.read
    this.fs.tree = this._db.tree
    this.fs.ls = this._db.ls

    this._onStop = this.options.onStop

    this._updateQueue = new PQueue({ concurrency: 1 })
    this._onDbUpdate = () =>
      this._updateQueue.size === 0 && this._updateQueue.add(() => this._getCid())

    this.running = null
  }

  static async create (fsstore, ipfs, options = {}) {
    const sharedfs = new SharedFS(fsstore, ipfs, options)
    if (sharedfs.options.autoStart) await sharedfs.start()
    return sharedfs
  }

  async start () {
    if (this.running !== null) { return }
    this.events.on('replicated', this._onDbUpdate)
    this.events.on('write', this._onDbUpdate)
    if (this.options.load) await this._db.load()
    this.running = true
    this.events.emit('start')
  }

  async stop ({ drop } = {}) {
    if (this.running !== true) { return }
    await this._onStop()
    this.events.removeListener('replicated', this._onDbUpdate)
    this.events.removeListener('write', this._onDbUpdate)
    await this._updateQueue.onIdle()
    drop ? await this._db.drop() : await this._db.close()
    this.running = false
    this.events.emit('stop')
  }

  async upload (path, source) {
    if (this.fs.content(path) !== 'dir') throw errors.pathDirNo(path)

    const prefix = (path) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))
    const name = (path) => path.slice(path.lastIndexOf('/') + 1)

    async function addToStore (content) {
      // parent(content.path) can be an empty string or a path
      const fsPath = `${path}${content.path && `/${content.path}`}`

      // handle dir
      if (content.mode === 493) {
        if (!this.fs.exists(fsPath)) {
          await this._db.mkdir(prefix(fsPath), name(fsPath))
        }
      }

      // handle file
      if (content.mode === 420) {
        if (!this.fs.exists(fsPath)) {
          await this._db.mk(prefix(fsPath), name(fsPath))
        }
        await this._db.write(
          this.fs.joinPath(prefix(fsPath), name(fsPath)),
          content.cid.toString()
        )
      }
    }

    try {
      const ipfsUpload = await all(this._ipfs.add(source, { pin: false }))
      await ipfsUpload
        .reverse() // start from root uploaded dir
        .reduce(
          async (a, c) => { await a; return addToStore.bind(this)(c) },
          Promise.resolve()
        )
      this.events.emit('upload')
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs.upload failed'))
      console.error('path:'); console.error(path)
      console.error('source:'); console.error(source)
      throw e
    }
  }

  async read (path) {
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    return this._getCid(path)
  }

  async remove (path) {
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    this.fs.content(path) === 'dir'
      ? await this._db.rmdir(path)
      : await this._db.rm(path)
    this.events.emit('remove')
  }

  async _getCid (path = '/r') {
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)

    function useCidClass (CID) {
      return function validCid (cid) {
        try {
          return !!new CID(cid)
        } catch (e) {
          return false
        }
      }
    }

    async function * ipfsTree (path) {
      const emptyFile = await last(this._ipfs.add(''))
      const validCid = useCidClass(emptyFile.cid.constructor)
      const fsStruct = [path, ...this.fs.tree(path)]
        .map((p) => ({
          path: p.slice(path.lastIndexOf('/')),
          content: this.fs.content(p) === 'file'
            ? this._ipfs.cat(
              (validCid(this.fs.read(p)) && this.fs.read(p)) ||
              emptyFile.cid
            )
            : undefined
        }))
      yield * this._ipfs.add(fsStruct, { pin: false })
    }

    try {
      const { cid } = await last(ipfsTree.bind(this)(path))
      return cid
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs._getCid failed'))
      console.error('path:'); console.error(path)
    }
  }
}

module.exports = SharedFS
