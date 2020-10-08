
'use strict'

const EventEmitter = require('events').EventEmitter
const { default: PQueue } = require('p-queue')
const util = require('./util')

const setHas = (set, ...a) => Boolean(a.filter(x => set.has(x)).length)
const missingCrypter = () => new Error('missing this.Crypter')

class AccessControl {
  constructor (db, options) {
    this._db = db
    this._ac = db.access
    this.options = options
    this.events = new EventEmitter()

    this._accessQueue = new PQueue({ concurrency: 1 })
    this._onAccessUpdate = () =>
      this._accessQueue.size === 0 &&
      this._accessQueue.add(() => this._accessUpdated())

    this.Crypter = options.Crypter
    this._sharedCrypter = util.sharedCrypter(this.Crypter)
    this.crypted = Boolean(this._db.options.meta && this._db.options.meta.enc)

    this.reading = null
    this.running = null
  }

  get identity () { return this._db.identity }

  get admin () { return this._ac._db ? this._ac.get('admin') : new Set() }

  get read () { return this._ac._db ? this._ac.get('read') : new Set() }

  get write () { return this._ac._db ? this._ac.get('write') : new Set(this._ac._write) }

  get hasAdmin () { return setHas(this.admin, this.identity.id, this.identity.publicKey, '*') }

  get hasRead () { return this.reading }

  get hasWrite () { return setHas(this.write, this.identity.id, this.identity.publicKey, '*') || this.hasAdmin }

  static async create (db, options) {
    const access = new AccessControl(db, options)
    await access.start()
    return access
  }

  async start () {
    if (this.running !== null) { return }
    if (this._crypted) {
      await this._setupEncryption()
    } else {
      this.reading = true
    }
    if (this._ac._db) {
      this._ac._db.events.on('replicated', this._onAccessUpdate)
      this._ac._db.events.on('write', this._onAccessUpdate)
    }
    this.running = true
  }

  async stop ({ drop } = {}) {
    if (this.running !== true) { return }
    if (this._ac._db) {
      this._ac._db.events.removeListener('replicated', this._onAccessUpdate)
      this._ac._db.events.removeListener('write', this._onAccessUpdate)
      await this._accessQueue.onIdle()
      await drop ? this._ac._db.drop() : this._ac._db.close()
    }
    this.running = false
  }

  async _setupEncryption () {
    if (this._db._crypter && this.hasAdmin) {
      if (!this.read.has(this.identity.publicKey)) {
        await this._grantRead(this.identity.publicKey)
      }
    }
    await this._setCrypter()
  }

  async _accessUpdatedAdmin () {}

  async _accessUpdated () {
    if (this.hasAdmin) await this._accessUpdatedAdmin()
    if (this._crypted && !this.hasRead) await this._setCrypter()
  }

  async grantRead (publicKey) {
    if (!this.crypted) throw new Error('db not encrypted, cannot grant read')
    if (!this.hasRead) throw new Error('no read permissions, cannot grant read')
    return this._grantRead(publicKey)
  }

  async _grantRead (publicKey) {
    if (!this.Crypter) throw missingCrypter()
    if (!this.hasAdmin) throw new Error('admin priviledges required to grant read')
    const bufferKey = Buffer.from(publicKey, 'hex')
    if (!util.verifyPub(bufferKey)) throw new Error('invalid publicKey provided')

    try {
      const privateKey = await this.identity.provider.keystore.getKey(this.identity.id)
      const crypter = await this._sharedCrypter(bufferKey, privateKey.marshal())
      const driveKey = await this.Crypter.exportKey(this._db._crypter._cryptoKey)
      const { cipherbytes, iv } = await crypter.encrypt(driveKey)

      const encryptedKey = {
        publicKey: this.identity.publicKey,
        cipherbytes: b64.fromByteArray(new Uint8Array(cipherbytes)),
        iv: b64.fromByteArray(iv)
      }
      const compressedHexPub = util.compressedPub(
        Buffer.from(this.identity.publicKey, 'hex')
      ).toString('hex')

      await this._ac.grant('read', compressedHexPub)
      await this._ac.grant(compressedHexPub, encryptedKey)
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs.grantRead failed'))
      console.error('publicKey:'); console.error(publicKey)
    }
  }

  async _setCrypter () {
    if (!this.Crypter) throw missingCrypter()
    const compressedHexPub = util.compressedPub(
      Buffer.from(this.identity.publicKey, 'hex')
    ).toString('hex')
    const read = this.read.has(this.identity.publicKey) || this.read.has(compressedHexPub)
    const set = this._ac._db.get(this.identity.publicKey) || this._ac._db.get(compressedHexPub)
    if (!read || !set) {
      this.reading = false
      return
    }

    try {
      const { publicKey, cipherbytes, iv } = set.values().next().value
      const privateKey = await this.identity.provider.keystore.getKey(this.identity.id)
      const crypter = await this._sharedCrypter(Buffer.from(publicKey, 'hex'), privateKey.marshal())
      const driveKey = await crypter.decrypt(b64.toByteArray(cipherbytes).buffer, b64.toByteArray(iv))

      const cryptoKey = await this.Crypter.importKey(driveKey)
      this._db.setCrypter(await this.Crypter.create(cryptoKey))

      this.reading = true
      await this._db._updateIndex()
      this._db.events.emit('write') // trigger the 'updated' event in sharedfs
      this.events.emit('encrypted')
    } catch (e) {
      console.error(e)
      console.error(new Error('sharedfs._setCrypter failed'))
      this.reading = false
    }
  }
}

module.exports = AccessControl
