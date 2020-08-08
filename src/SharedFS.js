
'use strict'

const EventEmitter = require('events').EventEmitter
const Buffer = require('safe-buffer').Buffer
const { default: PQueue } = require('p-queue')
const all = require('it-all')
const util = require('./util')
const { FS } = require('@tabcat/orbit-db-fsstore')
const { content, read, ls, pathName } = FS
const b64 = require('base64-js')

const errors = {
  ...FS.errors,
  notStarted: () => new Error('sharedfs was not started')
}

const writeReqs = (self) => {
  if (!self.running) throw errors.notStarted()
  if (self._encrypted && !self.crypting) throw new Error('encryption not yet set')
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

    this._accessQueue = new PQueue({ concurrency: 1 })
    this._onAccessUpdate = () => {
      this._accessQueue.size === 0 &&
      this._accessQueue.add(() => this._accessUpdated())
    }

    this._Crypter = options.Crypter
    this._sharedCrypter = util.sharedCrypter(this._Crypter)
    this._encrypted = Boolean(
      this._Crypter &&
      this._db.options.meta &&
      this._db.options.meta.enc &&
      this.access._db
    )

    this.running = null
    this.crypting = null

    this._emptyFile = null
    this._emptyDir = null
    this._CID = null
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
    if (this._encrypted) await this._setupEncryption()
    if (this.access._db) {
      this.access._db.events.on('replicated', this._onAccessUpdate)
      this.access._db.events.on('write', this._onAccessUpdate)
    }
    if (this.options.load) await this._db.load()
    this._emptyFile = await this._ipfs.add('')
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
    // this._onDbUpdate()
    this.events.emit('start')
  }

  async stop ({ drop } = {}) {
    if (this.running !== true) { return }
    await this._onStop()
    if (this.access._db) {
      this.access._db.events.removeListener('replicated', this._onAccessUpdate)
      this.access._db.events.removeListener('write', this._onAccessUpdate)
      await this._accessQueue.onIdle()
      drop ? await this.access._db.drop() : await this.access._db.close()
    }
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

  get identity () { return this._db.identity }

  async upload (path, source, options = {}) {
    writeReqs(this)
    const prefix = (path) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))
    const name = (path) => path.slice(path.lastIndexOf('/') + 1)

    const ipfsAddOptions = { ...options, ...util.ipfsAddConfig }

    const keyMap = this._encrypted ? new Map() : null
    source = this._encrypted
      ? util.encryptContent(this._Crypter, source, keyMap)
      : source

    try {
      const ipfsUpload = await all(this._ipfs.addAll(source, ipfsAddOptions))
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
          if (util.readCid(this.fs.read(fsPath)) !== content.cid.toString()) {
            const { cryptoKey, iv } = this._encrypted ? keyMap.get(content.path) : {}
            const rawKey = this._encrypted
              ? new Uint8Array(await this._Crypter.exportKey(cryptoKey))
              : null
            batch.write(
              this.fs.joinPath(prefix(fsPath), name(fsPath)),
              {
                cid: content.cid.toString(),
                ...this._encrypted
                  ? { key: b64.fromByteArray(rawKey), iv: b64.fromByteArray(iv) }
                  : {}
              }
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
    const Crypter = this._Crypter
    const key = file && file.key
    const iv = file && file.iv

    return {
      data: () => util.catCid(
        this._ipfs, util.readCid(file),
        { Crypter, key, iv, handleUpdate: options.handleUpdate }
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

  _fileCid (cid) {
    try {
      return new this._CID(cid)
    } catch (e) {
      return this._emptyFile.cid
    }
  }

  async _computeCid (path = this.fs.root) {
    writeReqs(this)

    const pathCid = async (fs, path) => {
      if (content(fs, path) === 'file') {
        return this._fileCid(util.readCid(read(fs, path)))
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

  async _setupEncryption () {
    const db = this._db
    const adminHas = (v) => db.access.get('admin').has(v)
    if (db._crypter && (adminHas(db.identity.id) || adminHas(db.identity.publicKey))) {
      if (!db.access.get('read').has(db.identity.publicKey)) {
        await this._grantRead(db.identity.publicKey)
      }
    }
    await this._setCrypter()
  }

  async _accessUpdatedAdmin () {}

  async _accessUpdated () {
    const db = this._db
    if (db.access.get('admin').has(db.identity.id)) {
      await this._accessUpdatedAdmin()
    }
    if (this._encrypted && !this.crypting) await this._setCrypter()
  }

  async grantRead (publicKey) {
    writeReqs(this)
    return this._grantRead(publicKey)
  }

  async _grantRead (publicKey) {
    const db = this._db
    const bufferKey = Buffer.from(publicKey, 'hex')
    const adminHas = (v) => db.access.get('admin').has(v)
    if (!adminHas(db.identity.id) && !adminHas(db.identity.publicKey)) {
      throw new Error('admin priviledges required to grant read')
    }
    if (!util.verifyPub(bufferKey)) {
      throw new Error('invalid publicKey provided')
    }

    const compressedPub = util.compressedPub(bufferKey)
    const compressedHexPub = compressedPub.toString('hex')

    try {
      const privateKey = await db.identity.provider.keystore.getKey(db.identity.id)

      const crypter = await this._sharedCrypter(bufferKey, privateKey.marshal())

      const driveKey = await this._Crypter.exportKey(db._crypter._cryptoKey)
      const { cipherbytes, iv } = await crypter.encrypt(driveKey)

      const encryptedKey = {
        publicKey: db.identity.publicKey,
        cipherbytes: b64.fromByteArray(new Uint8Array(cipherbytes)),
        iv: b64.fromByteArray(iv)
      }

      await db.access.grant('read', compressedHexPub)
      await db.access.grant(compressedHexPub, encryptedKey)
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs.grantRead failed'))
      console.error('publicKey:'); console.error(publicKey)
    }
  }

  async _setCrypter () {
    const db = this._db
    const readHas = (v) => db.access.get('read').has(v)
    const compressedPub = util.compressedPub(Buffer.from(db.identity.publicKey, 'hex'))
    const compressedHexPub = compressedPub.toString('hex')

    if (!readHas(db.identity.publicKey) && !readHas(compressedHexPub)) {
      this.crypting = false
      return
    }

    const set = db.access._db.get(db.identity.publicKey) || db.access._db.get(compressedHexPub)
    if (!set) {
      this.crypting = false
      return
    }

    try {
      const { publicKey, cipherbytes, iv } = set.values().next().value
      const privateKey = await db.identity.provider.keystore.getKey(db.identity.id)

      const crypter = await this._sharedCrypter(Buffer.from(publicKey, 'hex'), privateKey.marshal())

      const driveKey = await crypter.decrypt(
        b64.toByteArray(cipherbytes).buffer,
        b64.toByteArray(iv)
      )

      const cryptoKey = await this._Crypter.importKey(driveKey)
      db.setCrypter(await this._Crypter.create(cryptoKey))


      this.crypting = true
      await db._updateIndex()
      this.events.emit('updated')
      this.events.emit('encrypted')
      return
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs._setCrypter failed'))
      this.crypting = false
    }
  }
}

module.exports = SharedFS
