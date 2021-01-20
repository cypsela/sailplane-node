
'use strict'
const first = require('it-first')
const last = require('it-last')
const { readCid, ipfsAddConfig } = require('../src/util')

async function ipfsAddPath (path = this.fs.root) {
  const fileCid = (cid) => {
    try {
      return new this._CID(cid)
    } catch (e) {
      return this._emptyFileCid
    }
  }

  async function * ipfsTree (path) {
    const fsStruct = await Promise.all(
      [path, ...this.fs.tree(path)]
        .map(async (p) => {
          const { content, mtime, mode } = this.fs.content(p) === 'file'
            ? await first(this._ipfs.get(fileCid(readCid(this.fs.read(p)))))
            : {}
          return { path: p.slice(path.lastIndexOf('/')), content, mtime, mode }
        })
    )
    yield * this._ipfs.addAll(fsStruct, ipfsAddConfig)
  }

  try {
    if (this.fs.content(path) === 'file') {
      return fileCid(readCid(this.fs.read(path)))
    }

    const { cid } = await last(ipfsTree.bind(this)(path))
    return cid
  } catch (e) {
    console.error(e)
    console.error(new Error('ipfsAddPath failed'))
    console.error('path:'); console.error(path)
  }
}

module.exports = {
  ipfsAddPath
}
