
'use strict'
const first = require('it-first')
const { ipfsAddConfig, readCid } = require('../src/util')

async function secondLast (iterator) {
  const res = []

  for await (const entry of iterator) {
    if (res[0]) res[1] = res[0]
    res[0] = entry
  }

  return res.length === 2 ? res[1] : res[0]
}

async function ipfsAddPath (path = this.fs.root) {
  const fileCid = (cid) => {
    try {
      return new this._CID(cid)
    } catch (e) {
      return this._emptyFile.cid
    }
  }

  async function * ipfsTree (path) {
    const fsStruct = await Promise.all(
      [path, ...this.fs.tree(path)]
        .map(async (p) => {
          const { content, mtime, mode } = this.fs.content(p) === 'file'
            ? await first(
              this._ipfs.get(fileCid(readCid(this.fs.read(p))))
            )
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

    const { cid } = await secondLast(ipfsTree.bind(this)(path))
    return cid
  } catch (e) {
    console.error(e)
    console.error(new Error('ipfsAddPath failed'))
    console.error('path:'); console.error(path)
  }
}

const sortFn = (o, t) => o.toLowerCase().localeCompare(t.toLowerCase())

module.exports = {
  secondLast,
  ipfsAddPath,
  sortFn
}
