
'use strict'

const AccessControl = require('./AccessControl')
const EventEmitter = require('events').EventEmitter
const Buffer = require('safe-buffer').Buffer
const { default: PQueue } = require('p-queue')
const normaliseInput = require('ipfs-core-utils/src/files/normalise-input')
const treeBuilder = require('./tree-builder')
const util = require('./util')
const { FS } = require('@tabcat/orbit-db-fsstore')
const { content, read, ls, pathName } = FS
const { fromByteArray: b64 } = require('base64-js')

const errors = {
  ...FS.errors,
  notStarted: () => new Error('sharedfs was not started')
}

const writeReqs = (self) => {
  if (!self.running) throw errors.notStarted()
  if (!self.access.hasRead) throw new Error('missing read access')
  if (!self.access.hasWrite) throw new Error('missing write access')
}

const storeTypes = { lite: 0, full: 1, archive: 2 }

const defaultOptions = {
  autoStart: true,
  load: true,
  onStop: function () {},
  storeType: storeTypes.lite,
  Crypter: null
}

class SharedFS {
  constructor (db, ipfs, options = {}) {
    this._db = db
    this._ipfs = ipfs
    this.options = { ...defaultOptions, ...options }
    this.events = new EventEmitter()

    this.address = this._db.address

    this.fs = {}
    this.fs.root = this._db.root
    this.fs.joinPath = this._db.joinPath
    this.fs.pathName = this._db.pathName
    this.fs.exists = this._db.exists
    this.fs.content = this._db.content
    this.fs.read = this._db.read
    this.fs.tree = this._db.tree
    this.fs.ls = this._db.ls

    this._onStop = this.options.onStop

    const statsFirst = (p) => [...p.slice(-2), ...p.slice(0, -2)]
    this._dbProgress = {
      load: (...p) => this.events.emit('db.load.progress', ...statsFirst(p)),
      replicate: (...p) => this.events.emit('db.replicate.progress', ...statsFirst(p))
    }

    this._updateQueue = new PQueue({ concurrency: 1 })
    this._onDbUpdate = () => {
      this.events.emit('updated')
      this._updateQueue.size === 0 &&
      this._updateQueue.add(() => this._computeCid())
    }

    this._emptyDirCid = null
    this._emptyFileCid = null
    this._CID = null

    this.access = null
    this.running = null
  }

  get identity () { return this._db.identity }

  get encrypted () { return this.access.crypted }

  get Crypter () { return this.access.Crypter }

  static async create (fsstore, ipfs, options = {}) {
    const sharedfs = new SharedFS(fsstore, ipfs, options)
    if (sharedfs.options.autoStart) await sharedfs.start()
    return sharedfs
  }

  async start () {
    if (this.running !== null) { return }
    this._emptyDirCid = await this._ipfs.object.put({ Data: Buffer.from([8, 1]) })
    this._emptyFileCid = await this._ipfs.object.put({ Data: Buffer.from([8, 2]) })
    this._CID = this._emptyFileCid.constructor
    this.access = await AccessControl.create(this._db, this.options)
    this._db.events.on('load.progress', this._dbProgress.load)
    this._db.events.on('replicate.progress', this._dbProgress.replicate)
    this._db.events.on('replicated', this._onDbUpdate)
    this.events.on('upload', this._onDbUpdate)
    this.events.on('mkdir', this._onDbUpdate)
    this.events.on('mkfile', this._onDbUpdate)
    this.events.on('write', this._onDbUpdate)
    this.events.on('remove', this._onDbUpdate)
    this.events.on('move', this._onDbUpdate)
    this.events.on('copy', this._onDbUpdate)
    if (this.options.load) await this._db.load()
    if (this.access.hasRead) this._onDbUpdate()
    this.running = true
    this.events.emit('start')
  }

  async stop ({ drop } = {}) {
    if (this.running !== true) { return }
    await this._onStop()
    await this.access.stop({ drop })
    this._db.events.removeListener('load.progress', this._dbProgress.load)
    this._db.events.removeListener('replicate.progress', this._dbProgress.replicate)
    this._db.events.removeListener('replicated', this._onDbUpdate)
    this.events.removeListener('upload', this._onDbUpdate)
    this.events.removeListener('mkdir', this._onDbUpdate)
    this.events.removeListener('mkfile', this._onDbUpdate)
    this.events.removeListener('write', this._onDbUpdate)
    this.events.removeListener('remove', this._onDbUpdate)
    this.events.removeListener('move', this._onDbUpdate)
    this.events.removeListener('copy', this._onDbUpdate)
    await this._updateQueue.onIdle()
    drop ? await this._db.drop() : await this._db.close()
    this.running = false
    this.events.emit('stop')
  }

  async upload (path, source, options = {}) {
    writeReqs(this)
    const prefix = (path) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))
    const name = (path) => path.slice(path.lastIndexOf('/') + 1)

    const ipfsAddOptions = { ...options, ...util.ipfsAddConfig }

    try {
      const tree = await treeBuilder(normaliseInput(source))
      const batch = this._db.batch()
      for (const item of tree.traverse()) {
        item.path = util.removeSlash(item.path)
        const fsPath = `${path}${item.path && `/${item.path}`}`
        if (item.content) {
          if (!this.fs.exists(fsPath)) {
            batch.mk(prefix(fsPath), name(fsPath))
          }
          const { mode, mtime, content } = item
          const enc = this.encrypted && await util.encryptContent(this.Crypter, content)
          const { cid } = await this._ipfs.add(
            this.encrypted ? enc.cipherbytes : content,
            ipfsAddOptions
          )
          if (util.readCid(this.fs.read(fsPath)) !== cid.toString()) {
            batch.write(
              this.fs.joinPath(prefix(fsPath), name(fsPath)),
              {
                cid: cid.toString(),
                ...this.encrypted ? { key: b64(enc.rawKey), iv: b64(enc.iv) } : {},
                ...mtime ? { mtime } : {}
              }
            )
          }
        } else {
          if (!this.fs.exists(fsPath)) {
            batch.mkdir(prefix(fsPath), name(fsPath))
          }
        }
      }

      await batch.execute()
      this.events.emit('upload')
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs.upload failed'))
      console.error('path:'); console.error(path)
      console.error('source:'); console.error(source)
      throw e
    }
  }

  async mkdir (path, name) {
    writeReqs(this)
    await this._db.mkdir(path, name)
    this.events.emit('mkdir')
  }

  async mkfile (path, name) {
    writeReqs(this)
    await this._db.mk(path, name)
    this.events.emit('mkfile')
  }

  async write (path, cid, options = {}) {
    writeReqs(this)
    if (!util.validCid(this._CID, cid)) throw new Error('invalid cid')
    await this._db.write(path, { cid: cid.toString(), key: options.key })
    this.events.emit('write')
  }

  async read (path) {
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    return this._computeCid(path)
  }

  cat (path, options = {}) {
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    if (this.fs.content(path) !== 'file') throw errors.pathFileNo(path)
    const file = this.fs.read(path)
    const key = file && file.key
    const iv = file && file.iv
    return {
      data: () => util.catCid(
        this._ipfs, util.readCid(file),
        { Crypter: this.Crypter, key, iv, handleUpdate: options.handleUpdate }
      )
    }
  }

  async remove (path) {
    writeReqs(this)
    this.fs.content(path) === 'dir'
      ? await this._db.rmdir(path)
      : await this._db.rm(path)
    this.events.emit('remove')
  }

  async move (path, dest, name) {
    writeReqs(this)
    this.fs.content(path) === 'dir'
      ? await this._db.mvdir(path, dest, name)
      : await this._db.mv(path, dest, name)
    this.events.emit('move')
  }

  async copy (path, dest, name) {
    writeReqs(this)
    this.fs.content(path) === 'dir'
      ? await this._db.cpdir(path, dest, name)
      : await this._db.cp(path, dest, name)
    this.events.emit('copy')
  }

  async _computeCid (path = this.fs.root) {
    if (!this.access.hasRead) {
      console.warn('_computeCid skipped, no read access')
      return
    }

    const fileCid = (cid) => {
      try {
        return new this._CID(cid)
      } catch (e) {
        return this._emptyFileCid
      }
    }

    const pathCid = async (fs, path) => {
      if (content(fs, path) === 'file') {
        return fileCid(util.readCid(read(fs, path)))
      }
      const dirLinks = await Promise.all(
        ls(fs, path)
          .map(async (p) => {
            const cid = await pathCid(fs, p)
            const { size } = await this._ipfs.object.get(cid)
            return { name: pathName(p), size, cid }
          })
      )
      if (dirLinks.length === 0) return this._emptyDirCid
      // Data buffer says unixFs and directory
      return this._ipfs.object.put({ Data: Buffer.from([8, 1]), Links: dirLinks })
    }

    try {
      const fs = this._db.index
      const cid = await pathCid(fs, path)
      if (path === this.fs.root && this.options.storeType > storeTypes.lite) {
        ipfs.get(cid)
      }
      return cid
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs._computeCid failed'))
      console.error('path:'); console.error(path)
    }
  }
}

module.exports = SharedFS
