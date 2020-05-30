
'use strict'

const assert = require('assert')
const rmrf = require('rimraf')
const path = require('path')
const OrbitDB = require('orbit-db')
const SailplaneNode = require('../src')
const globSource = require('ipfs-utils/src/files/glob-source')
const first = require('it-first')
const last = require('it-last')

const {
  config,
  startIpfs,
  stopIpfs,
  testAPIs
} = require('orbit-db-test-utils')

const dbPath = './orbitdb/tests/sharedfs'
const ipfsPath = './orbitdb/tests/sharedfs/ipfs'

Object.keys(testAPIs).forEach(API => {
  describe(`SharedFS (${API})`, function () {
    this.timeout(config.timeout)

    let ipfsd, ipfs, orbitdb1, sailplane1, address1, sharedfs1

    before(async () => {
      config.daemon1.repo = ipfsPath
      rmrf.sync(config.daemon1.repo)
      ipfsd = await startIpfs(API, config.daemon1)
      ipfs = ipfsd.api
      orbitdb1 = await OrbitDB.createInstance(ipfs, { directory: path.join(dbPath, '1') })
      sailplane1 = await SailplaneNode.create(orbitdb1)
      address1 = await sailplane1.determineAddress('sharedfs1')
    })

    after(async () => {
      if (sailplane1) {
        await sailplane1.stop()
        assert.strict.deepEqual(sailplane1.mounted, {})
      }

      if (orbitdb1) {
        await orbitdb1.stop()
      }

      if (ipfsd) {
        await stopIpfs(ipfsd)
      }
    })

    beforeEach(async function () {
      sharedfs1 = await sailplane1.mount(address1)
    })

    afterEach(async function () {
      await sharedfs1.stop({ drop: true })
    })

    it('upload a file', async function () {
      const path = './test/fixtures/folderWithFiles/mittens.jpg'
      let eventCount = 0
      sharedfs1.events.on('upload', () => eventCount++)
      await sharedfs1.upload('/r', globSource(path))
      assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
      assert.strict.equal(eventCount, 1)
    })

    it('upload a directory', async function () {
      const path = './test/fixtures/folderWithFiles'
      let eventCount = 0
      sharedfs1.events.on('upload', () => eventCount++)
      await sharedfs1.upload('/r', globSource(path, { recursive: true }))
      assert.strict.deepEqual(
        sharedfs1.fs.tree('/r'),
        [
          '/r/folderWithFiles',
          '/r/folderWithFiles/moreFiles',
          '/r/folderWithFiles/moreFiles/hamlet.txt',
          '/r/folderWithFiles/moreFiles/DnTFT3BWwAEslk6.jpg',
          '/r/folderWithFiles/mittens.jpg',
          '/r/folderWithFiles/hello.txt',
          '/r/folderWithFiles/grey-fur-kitten-127028.jpg',
          '/r/folderWithFiles/close-up-of-cat-248280.jpg'
        ]
      )
      assert.strict.equal(eventCount, 1)
    })

    it('read a file', async function () {
      const path = './test/fixtures/folderWithFiles/mittens.jpg'
      await sharedfs1.upload('/r', globSource(path))
      assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
      const read = await last(sharedfs1.read('/r/mittens.jpg'))
      assert.strict.equal(read.cid.toString(), 'QmPmSxRWBs9TedaVdj7NMXpU3btHydyNwsCrLWEyyVYLDW')
      assert.strict.equal(read.path, 'QmPmSxRWBs9TedaVdj7NMXpU3btHydyNwsCrLWEyyVYLDW')
      assert.strict.equal(read.name, 'QmPmSxRWBs9TedaVdj7NMXpU3btHydyNwsCrLWEyyVYLDW')
      assert.strict.equal(read.depth, 1)
      assert.strict.equal(read.size, 16634)
      assert.strict.equal(read.type, 'file')
      assert.strict.equal(read.mode, 420)
      assert.strict.equal(read.mtime, undefined)
    })

    it('read a directory', async function () {
      const path = './test/fixtures/folderWithFiles'
      await sharedfs1.upload('/r', globSource(path, { recursive: true }))
      assert.strict.deepEqual(
        sharedfs1.fs.tree('/r'),
        [
          '/r/folderWithFiles',
          '/r/folderWithFiles/moreFiles',
          '/r/folderWithFiles/moreFiles/hamlet.txt',
          '/r/folderWithFiles/moreFiles/DnTFT3BWwAEslk6.jpg',
          '/r/folderWithFiles/mittens.jpg',
          '/r/folderWithFiles/hello.txt',
          '/r/folderWithFiles/grey-fur-kitten-127028.jpg',
          '/r/folderWithFiles/close-up-of-cat-248280.jpg'
        ]
      )
      const read = await first(sharedfs1.read('/r'))
      assert.strict.equal(read.cid.toString(), 'QmXUDejG4nxgcZsig4kgBnKJE7ioCYKmspyr1zrm86fdDD')
      assert.strict.equal(read.path, 'QmXUDejG4nxgcZsig4kgBnKJE7ioCYKmspyr1zrm86fdDD')
      assert.strict.equal(read.name, 'QmXUDejG4nxgcZsig4kgBnKJE7ioCYKmspyr1zrm86fdDD')
      assert.strict.equal(read.depth, 1)
      assert.strict.equal(read.size, 0)
      assert.strict.equal(read.type, 'dir')
      assert.strict.equal(read.mode, 493)
      assert.strict.equal(read.mtime, undefined)
    })

    it('remove a file', async function () {
      const path = './test/fixtures/folderWithFiles/mittens.jpg'
      let eventCount = 0
      sharedfs1.events.on('upload', () => eventCount++)
      await sharedfs1.upload('/r', globSource(path))
      assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
      await sharedfs1.remove('/r/mittens.jpg')
      assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [])
      assert.strict.equal(eventCount, 1)
    })

    it('remove a directory', async function () {
      const path = './test/fixtures/folderWithFiles'
      let eventCount = 0
      sharedfs1.events.on('upload', () => eventCount++)
      await sharedfs1.upload('/r', globSource(path, { recursive: true }))
      assert.strict.deepEqual(
        sharedfs1.fs.tree('/r'),
        [
          '/r/folderWithFiles',
          '/r/folderWithFiles/moreFiles',
          '/r/folderWithFiles/moreFiles/hamlet.txt',
          '/r/folderWithFiles/moreFiles/DnTFT3BWwAEslk6.jpg',
          '/r/folderWithFiles/mittens.jpg',
          '/r/folderWithFiles/hello.txt',
          '/r/folderWithFiles/grey-fur-kitten-127028.jpg',
          '/r/folderWithFiles/close-up-of-cat-248280.jpg'
        ]
      )
      await sharedfs1.remove('/r/folderWithFiles')
      assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [])
      assert.strict.equal(eventCount, 1)
    })
  })
})
