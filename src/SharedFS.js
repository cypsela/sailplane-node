
'use strict'

const EventEmitter = require('events').EventEmitter
const Buffer = require('safe-buffer').Buffer
const { default: PQueue } = require('p-queue')
const all = require('it-all')
const last = require('it-last')
const { validCid, ipfsAddConfig } = require('./util')
const { FS } = require('@tabcat/orbit-db-fsstore')
const { content, read, ls, pathName } = FS

const errors = {
  ...FS.errors,
  notStarted: () => new Error('sharedfs was not started')
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
    this.events = new EventEmitter()

    this.address = this._db.address
    this.access = this._db.access

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

    const statsFirst = (p) => [...p.slice(-2) , ...p.slice(0, -2)]
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
    this._emptyFile = null
    this._emptyDir = null
    this._CID = null

    this.running = null
  }

  static async create (fsstore, ipfs, options = {}) {
    const sharedfs = new SharedFS(fsstore, ipfs, options)
    if (sharedfs.options.autoStart) await sharedfs.start()
    return sharedfs
  }

  async start () {
    if (this.running !== null) { return }
    this._db.events.on('load.progress', this._dbProgress.load)
    this._db.events.on('replicate.progress', this._dbProgress.replicate)
    if (this.options.load) await this._db.load()
    this._emptyFile = await last(this._ipfs.add(''))
    this._emptyDir = await this._ipfs.object.patch.setData(
      await this._ipfs.object.new(),
      Buffer.from([8, 1])
    )
    this._CID = this._emptyFile.cid.constructor
    this._db.events.on('replicated', this._onDbUpdate)
    this.events.on('upload', this._onDbUpdate)
    this.events.on('mkdir', this._onDbUpdate)
    this.events.on('mkfile', this._onDbUpdate)
    this.events.on('write', this._onDbUpdate)
    this.events.on('remove', this._onDbUpdate)
    this.events.on('move', this._onDbUpdate)
    this.events.on('copy', this._onDbUpdate)
    this.running = true
    this._onDbUpdate()
    this.events.emit('start')
  }

  async stop ({ drop } = {}) {
    if (this.running !== true) { return }
    await this._onStop()
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
    if (!this.running) throw errors.notStarted()
    if (this.fs.content(path) !== 'dir') throw errors.pathDirNo(path)

    const prefix = (path) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))
    const name = (path) => path.slice(path.lastIndexOf('/') + 1)

    const ipfsAddOptions = { ...options, ...ipfsAddConfig }

    try {
      const ipfsUpload = await all(this._ipfs.add(source, ipfsAddOptions))
      const batch = this._db.batch()

      for (const content of ipfsUpload.slice().reverse()) {
        // parent(content.path) can be an empty string or a path
        const fsPath = `${path}${content.path && `/${content.path}`}`

        // handle dir
        if (content.mode === 493) {
          if (!this.fs.exists(fsPath)) {
            batch.mkdir(prefix(fsPath), name(fsPath))
          }
        }

        // handle file
        if (content.mode === 420) {
          if (!this.fs.exists(fsPath)) {
            batch.mk(prefix(fsPath), name(fsPath))
          }
          if (this.fs.read(fsPath) !== content.cid.toString()) {
            batch.write(
              this.fs.joinPath(prefix(fsPath), name(fsPath)),
              content.cid.toString()
            )
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
    if (!this.running) throw errors.notStarted()
    await this._db.mkdir(path, name)
    this.events.emit('mkdir')
  }

  async mkfile (path, name) {
    if (!this.running) throw errors.notStarted()
    await this._db.mk(path, name)
    this.events.emit('mkfile')
  }

  async write (path, cid) {
    if (!this.running) throw errors.notStarted()
    if (!validCid(this._CID, cid)) throw new Error('invalid cid')
    await this._db.write(path, cid.toString())
    this.events.emit('write')
  }

  async read (path) {
    if (!this.running) throw errors.notStarted()
    return this._computeCid(path)
  }

  async remove (path) {
    if (!this.running) throw errors.notStarted()
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    this.fs.content(path) === 'dir'
      ? await this._db.rmdir(path)
      : await this._db.rm(path)
    this.events.emit('remove')
  }

  async move (path, dest, name) {
    if (!this.running) throw errors.notStarted()
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    this.fs.content(path) === 'dir'
      ? await this._db.mvdir(path, dest, name)
      : await this._db.mv(path, dest, name)
    this.events.emit('move')
  }

  async copy (path, dest, name) {
    if (!this.running) throw errors.notStarted()
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)
    this.fs.content(path) === 'dir'
      ? await this._db.cpdir(path, dest, name)
      : await this._db.cp(path, dest, name)
    this.events.emit('copy')
  }

  async _computeCid (path = this.fs.root) {
    if (!this.running) throw errors.notStarted()
    if (!this.fs.exists(path)) throw errors.pathExistNo(path)

    const fileCid = (cid) => {
      try {
        return new this._CID(cid)
      } catch (e) {
        return this._emptyFile.cid
      }
    }

    const pathCid = async (fs, path) => {
      if (content(fs, path) === 'file') {
        return fileCid(read(fs, path))
      }

      const dirLinks = await Promise.all(
        ls(fs, path)
          .map(async (p) => {
            const cid = await pathCid(fs, p)
            const { size } = await this._ipfs.object.get(cid)
            return { name: pathName(p), size, cid }
          })
      )

      return dirLinks.reduce(
        async (cid, link) => {
          cid = await cid
          return this._ipfs.object.patch.addLink(cid, link)
        },
        this._emptyDir
      )
    }

    try {
      const fs = this._db.index
      return pathCid(fs, path)
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs._computeCid failed'))
      console.error('path:'); console.error(path)
    }
  }
}

module.exports = SharedFS
