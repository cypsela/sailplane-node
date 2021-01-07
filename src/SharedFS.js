
'use strict'

const AccessControl = require('./AccessControl')
const EventEmitter = require('events').EventEmitter
const { default: PQueue } = require('p-queue')
const all = require('it-all')
const normaliseInput = require('ipfs-core-utils/src/files/normalise-input')
const treeBuilder = require('./tree-builder')
const { cids, crypto, buffer: { concatBuffers }, ...util } = require('./util')
const {
  FS: { content, read, ls, pathName, errors, lowercase: opcodes, cTypes }
} = require('@tabcat/orbit-db-fsstore')

errors.notStarted = () => new Error('sharedfs was not started')

const readReqs = (self) => {
  if (!self.running) throw errors.notStarted()
  if (!self.access.hasRead) throw new Error('missing read access')
}

const writeReqs = (self) => {
  readReqs(self)
  if (!self.access.hasWrite) throw new Error('missing write access')
}

const unixFsType = {
  dir: Uint8Array.from([8, 1]),
  file: Uint8Array.from([8, 2])
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
    this.fs.baseName = this._db.baseName
    this.fs.exists = this._db.exists
    this.fs.content = this._db.content
    this.fs.read = this._db.read
    this.fs.tree = this._db.tree
    this.fs.ls = this._db.ls

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
    this._realCid = (cid) => cids.parseCid(this._CID, cid) || this._emptyFileCid

    this.access = null
    this.running = null
  }

  get identity () { return this._db.identity }

  get encrypted () { return this.access.crypted }

  static async create (fsstore, ipfs, options = {}) {
    const sharedfs = new SharedFS(fsstore, ipfs, options)
    if (sharedfs.options.autoStart) await sharedfs.start()
    return sharedfs
  }

  async start () {
    if (this.running !== null) { return }
    this._emptyDirCid = await this._ipfs.object.put({ Data: unixFsType.dir })
    this._emptyFileCid = await this._ipfs.object.put({ Data: unixFsType.file })
    this._CID = this._emptyFileCid.constructor
    this.access = await AccessControl.create(this._db, this.options)
    this.access.events.on('encrypted', this._onDbUpdate)
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
    await this.options.onStop()
    this.access.events.removeListener('encrypted', this._onDbUpdate)
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
    await Promise.all([this.access.stop({ drop }), this._updateQueue.onIdle()])
    drop ? await this._db.drop() : await this._db.close()
    this.running = false
    this.events.emit('stop')
  }

  async upload (path, source, options = {}) {
    writeReqs(this)

    const ipfsAddOptions = { ...options, ...util.ipfsAddConfig }

    try {
      const tree = await treeBuilder(normaliseInput(source))
      const batch = this._db.batch()

      for (const item of tree.traverse()) {
        item.path = util.removeSlash(item.path)
        const fsPath = `${path}${item.path && `/${item.path}`}`
        if (item.content) {
          if (!this.fs.exists(fsPath)) {
            batch.mk(this.fs.baseName(fsPath), this.fs.pathName(fsPath))
          }
          const { mtime, content } = item
          let src, decrypt = {}
          if (this.encrypted) {
            const enc = await crypto.encryptContent(
              this.access.Crypter,
              await concatBuffers(content)
            )
            src = enc.cipherbytes
            decrypt = { key: enc.key, iv: enc.iv }
          } else {
            src = content
          }

          const { cid } = await this._ipfs.add(src, ipfsAddOptions)
          if (cids.readCid(this.fs.read(fsPath)) !== cid.toString()) {
            const json = { cid: cid.toString(), ...decrypt, ...(mtime ? { mtime } : {}) }
            batch.write(fsPath, json)
          }
        } else {
          if (!this.fs.exists(fsPath)) {
            batch.mkdir(this.fs.baseName(fsPath), this.fs.pathName(fsPath))
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
    if (!cids.validCid(this._CID, cid)) throw new Error('invalid cid')
    await this._db.write(path, { cid: cid.toString(), key: options.key })
    this.events.emit('write')
  }

  async read (path) {
    readReqs(this)
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    return this._computeCid(path)
  }

  cat (path, { handleUpdate } = {}) {
    readReqs(this)
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    if (this.fs.content(path) !== cTypes.file) throw errors.pathFileNo(path)
    const file = this.fs.read(path)
    const cid = this._realCid(cids.readCid(file))

    return {
      data: async () => {
        let [{ content, size: total }] = await all(this._ipfs.get(cid))
        if (!content || total === 0) return new Uint8Array()
        content = await concatBuffers(this._ipfs.cat(cid), { total, handleUpdate })

        return this.encrypted
          ? crypto.decryptContent(this.access.Crypter, content, { key: file.key, iv: file.iv })
          : content
      }
    }
  }

  _handleMutateFns(op, path, dest, name) {
    const key = this.fs.content(path) === cTypes.dir ? op + cTypes.dir : op
    return this._db[key](path, dest, name)
  }

  async remove (path) {
    writeReqs(this)
    await this._handleMutateFns(opcodes.RM, path)
    this.events.emit('remove')
  }

  async move (path, dest, name) {
    writeReqs(this)
    await this._handleMutateFns(opcodes.MV, path, dest, name)
    this.events.emit('move')
  }

  async copy (path, dest, name) {
    writeReqs(this)
    await this._handleMutateFns(opcodes.CP, path, dest, name)
    this.events.emit('copy')
  }

  async _computeCid (path = this.fs.root) {
    if (!this.access.hasRead) {
      console.warn('_computeCid skipped, no read access')
      return
    }

    const pathCid = async (fs, path) => {
      if (content(fs, path) === cTypes.file) {
        return this._realCid(cids.readCid(read(fs, path)))
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
      // Data says unixFs and directory
      return this._ipfs.object.put({ Data: unixFsType.dir, Links: dirLinks })
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
