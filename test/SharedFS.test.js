
'use strict'

const assert = require('assert')
const rmrf = require('rimraf')
const path = require('path')
const OrbitDB = require('orbit-db')
const SailplaneNode = require('../src')
const { cids: { readCid }, sortFn } = require('../src/util')
const globSource = require('ipfs-utils/src/files/glob-source')
const { ipfsAddPath } = require('./util')
const Crypter = require('@tabcat/aes-gcm-crypter')

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

    let ipfsd, ipfs, orbitdb1, sailplane1, address1, file1, sharedfs1

    before(async () => {
      config.daemon1.repo = ipfsPath
      rmrf.sync(config.daemon1.repo)
      ipfsd = await startIpfs(API, config.daemon1)
      ipfs = ipfsd.api
      orbitdb1 = await OrbitDB.createInstance(ipfs, { directory: path.join(dbPath, '1') })
      sailplane1 = await SailplaneNode.create(orbitdb1)
      file1 = await ipfs.add('data', { pin: false })
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

    describe('SharedFS Instance', function () {
      before(async function () {
        address1 = await sailplane1.determineAddress('sharedfs1')
      })

      beforeEach(async function () {
        sharedfs1 = await sailplane1.mount(address1)
      })

      afterEach(async function () {
        await sharedfs1.stop({ drop: true })
      })

      it('upload a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
      })

      it('upload a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
      })

      it('make a directory', async function () {
        let updatedCount = 0
        let mkdirCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('mkdir', () => mkdirCount++)

        await sharedfs1.mkdir('/r', 'dirname')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          [
            '/r/dirname'
          ]
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(mkdirCount, 1)
      })

      it('make a file', async function () {
        let updatedCount = 0
        let mkfileCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('mkfile', () => mkfileCount++)

        await sharedfs1.mkfile('/r', 'filename')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          [
            '/r/filename'
          ]
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(mkfileCount, 1)
      })

      it('write to a file', async function () {
        let updatedCount = 0
        let mkfileCount = 0
        let writeCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('mkfile', () => mkfileCount++)
        sharedfs1.events.on('write', () => writeCount++)

        await sharedfs1.mkfile('/r', 'filename')
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(mkfileCount, 1)
        assert.strict.equal(writeCount, 0)

        const path = sharedfs1.fs.joinPath('/r', 'filename')

        await sharedfs1.write(path, file1.cid)
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          [
            '/r/filename'
          ]
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(mkfileCount, 1)
        assert.strict.equal(writeCount, 1)
        assert.strict.equal(readCid(sharedfs1.fs.read(path)), file1.cid.toString())
      })

      it('read a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)

        const filePath = '/r/mittens.jpg'
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [filePath])

        const cid = await sharedfs1.read(filePath)
        const ipfsAddCid = await ipfsAddPath.bind(sharedfs1)(filePath)
        assert.strict.equal(cid.toString(), 'QmPmSxRWBs9TedaVdj7NMXpU3btHydyNwsCrLWEyyVYLDW')
        assert.strict.equal(ipfsAddCid.toString(), 'QmPmSxRWBs9TedaVdj7NMXpU3btHydyNwsCrLWEyyVYLDW')
      })

      it('read a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)

        const dirPath = '/r'

        const cid = await sharedfs1.read(dirPath)
        const ipfsAddCid = await ipfsAddPath.bind(sharedfs1)(dirPath)
        assert.strict.equal(cid.toString(), 'QmXUDejG4nxgcZsig4kgBnKJE7ioCYKmspyr1zrm86fdDD')
        assert.strict.equal(ipfsAddCid.toString(), 'QmXUDejG4nxgcZsig4kgBnKJE7ioCYKmspyr1zrm86fdDD')
      })

      it('read a non existing path throws', async function () {
        await assert.rejects(() => sharedfs1.read('/nonExist'))
      })

      it('cat a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)

        const filePath = '/r/mittens.jpg'
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [filePath])

        const cat = sharedfs1.cat(filePath)
        const buffer = await cat.data()
        assert.strict.equal(buffer.length, 16634)
      })

      it('cat a directory throws', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)

        const dirPath = '/r'

        assert.throws(() => sharedfs1.cat(dirPath))
      })

      it('cat a non existing path throws', async function () {
        assert.throws(() => sharedfs1.cat('/nonExist'))
      })

      it('remove a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        let removeCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('remove', () => removeCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(removeCount, 0)

        await sharedfs1.remove('/r/mittens.jpg')
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [])
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(removeCount, 1)
      })

      it('remove a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        let removeCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('remove', () => removeCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(removeCount, 0)

        await sharedfs1.remove('/r/folderWithFiles')
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [])
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(removeCount, 1)
      })

      it('move a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        let moveCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('move', () => moveCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(moveCount, 0)

        await sharedfs1.move('/r/mittens.jpg', '/r', 'file1')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          ['/r/file1']
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(moveCount, 1)
      })

      it('move a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        let moveCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('move', () => moveCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(moveCount, 0)

        await sharedfs1.move('/r/folderWithFiles', '/r', 'dir1')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          [
            '/r/dir1',
            '/r/dir1/moreFiles',
            '/r/dir1/moreFiles/hamlet.txt',
            '/r/dir1/moreFiles/DnTFT3BWwAEslk6.jpg',
            '/r/dir1/mittens.jpg',
            '/r/dir1/hello.txt',
            '/r/dir1/grey-fur-kitten-127028.jpg',
            '/r/dir1/close-up-of-cat-248280.jpg'
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(moveCount, 1)
      })

      it('copy a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        let copyCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('copy', () => copyCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(copyCount, 0)

        await sharedfs1.copy('/r/mittens.jpg', '/r', 'file1')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          ['/r/file1', '/r/mittens.jpg']
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(copyCount, 1)
      })

      it('copy a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        let copyCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('copy', () => copyCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(copyCount, 0)

        await sharedfs1.copy('/r/folderWithFiles', '/r', 'dir1')
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
            '/r/folderWithFiles/close-up-of-cat-248280.jpg',
            '/r/dir1',
            '/r/dir1/moreFiles',
            '/r/dir1/moreFiles/hamlet.txt',
            '/r/dir1/moreFiles/DnTFT3BWwAEslk6.jpg',
            '/r/dir1/mittens.jpg',
            '/r/dir1/hello.txt',
            '/r/dir1/grey-fur-kitten-127028.jpg',
            '/r/dir1/close-up-of-cat-248280.jpg'
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(copyCount, 1)
      })

      it('exposes db load.progress', async function () {
        let expectedCount = 0
        // upload a directory
        const path = './test/fixtures/folderWithFiles'
        await sharedfs1.upload('/r', globSource(path, { recursive: true }))
        expectedCount++

        // make a directory
        await sharedfs1.mkdir('/r', 'dirname')
        expectedCount++

        // make a file
        await sharedfs1.mkfile('/r', 'filename')
        expectedCount++

        // write to a file
        await sharedfs1.write('/r/filename', file1.cid)
        expectedCount++

        // reopen sharedfs1
        await sharedfs1.stop()
        sharedfs1 = await sailplane1.mount(address1, { autoStart: false })

        let loadProgressCount = 0
        sharedfs1.events.on('db.load.progress', () => loadProgressCount++)
        await sharedfs1.start()
        assert.strict.equal(loadProgressCount, expectedCount)
      })

      it('exposes db access', async function () {
        assert.strict.equal(Boolean(sharedfs1.access), true)
        assert.strict.equal(sharedfs1.access._ac, sharedfs1._db.access)
      })

      it('exposes db identity', async function () {
        assert.strict.equal(sharedfs1.identity, sharedfs1._db.identity)
      })
    })

    describe('SharedFS Instance (encrypted)', function () {
      let crypter

      before(async function () {
        const options = {
          accessController: { type: 'orbitdb' },
          meta: { enc: true }
        }
        address1 = await sailplane1.determineAddress('sharedfs1', options)
        const cryptoKey = await Crypter.generateKey()
        crypter = await Crypter.create(cryptoKey)
      })

      beforeEach(async function () {
        sharedfs1 = await sailplane1.mount(address1, { crypter, Crypter })
      })

      afterEach(async function () {
        await sharedfs1.stop({ drop: true })
      })

      it('upload a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
      })

      it('upload a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
      })

      it('make a directory', async function () {
        let updatedCount = 0
        let mkdirCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('mkdir', () => mkdirCount++)

        await sharedfs1.mkdir('/r', 'dirname')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          [
            '/r/dirname'
          ]
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(mkdirCount, 1)
      })

      it('make a file', async function () {
        let updatedCount = 0
        let mkfileCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('mkfile', () => mkfileCount++)

        await sharedfs1.mkfile('/r', 'filename')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          [
            '/r/filename'
          ]
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(mkfileCount, 1)
      })

      it('write to a file', async function () {
        let updatedCount = 0
        let mkfileCount = 0
        let writeCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('mkfile', () => mkfileCount++)
        sharedfs1.events.on('write', () => writeCount++)

        await sharedfs1.mkfile('/r', 'filename')
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(mkfileCount, 1)
        assert.strict.equal(writeCount, 0)

        const path = sharedfs1.fs.joinPath('/r', 'filename')

        await sharedfs1.write(path, file1.cid)
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          [
            '/r/filename'
          ]
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(mkfileCount, 1)
        assert.strict.equal(writeCount, 1)
        assert.strict.equal(readCid(sharedfs1.fs.read(path)), file1.cid.toString())
      })

      it('read a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)

        const filePath = '/r/mittens.jpg'
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [filePath])

        const cid = await sharedfs1.read(filePath)
        const ipfsObjectStat = await sharedfs1._ipfs.object.stat(cid)
        assert.strict.equal(ipfsObjectStat.NumLinks, 0)
        assert.strict.equal(ipfsObjectStat.BlockSize, 16664)
        assert.strict.equal(ipfsObjectStat.LinksSize, 4)
        assert.strict.equal(ipfsObjectStat.DataSize, 16660)
        assert.strict.equal(ipfsObjectStat.CumulativeSize, 16664)
      })

      it('read a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)

        const dirPath = '/r'

        const cid = await sharedfs1.read(dirPath)
        const ipfsObjectStat = await sharedfs1._ipfs.object.stat(cid)
        assert.strict.equal(ipfsObjectStat.NumLinks, 1)
        assert.strict.equal(ipfsObjectStat.BlockSize, 63)
        assert.strict.equal(ipfsObjectStat.LinksSize, 61)
        assert.strict.equal(ipfsObjectStat.DataSize, 2)
        assert.strict.equal(ipfsObjectStat.CumulativeSize, 1952888)
      })

      it('read a non existing path throws', async function () {
        await assert.rejects(() => sharedfs1.read('/nonExist'))
      })

      it('cat a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)

        const filePath = '/r/mittens.jpg'
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [filePath])

        const cat = sharedfs1.cat(filePath)
        const buffer = await cat.data()
        assert.strict.equal(buffer.length, 16634)
      })

      it('cat a directory throws', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)

        const dirPath = '/r'

        assert.throws(() => sharedfs1.cat(dirPath))
      })

      it('cat a non existing path throws', async function () {
        assert.throws(() => sharedfs1.cat('/nonExist'))
      })

      it('remove a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        let removeCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('remove', () => removeCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(removeCount, 0)

        await sharedfs1.remove('/r/mittens.jpg')
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [])
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(removeCount, 1)
      })

      it('remove a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        let removeCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('remove', () => removeCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(removeCount, 0)

        await sharedfs1.remove('/r/folderWithFiles')
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), [])
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(removeCount, 1)
      })

      it('move a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        let moveCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('move', () => moveCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(moveCount, 0)

        await sharedfs1.move('/r/mittens.jpg', '/r', 'file1')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          ['/r/file1']
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(moveCount, 1)
      })

      it('move a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        let moveCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('move', () => moveCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(moveCount, 0)

        await sharedfs1.move('/r/folderWithFiles', '/r', 'dir1')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          [
            '/r/dir1',
            '/r/dir1/moreFiles',
            '/r/dir1/moreFiles/hamlet.txt',
            '/r/dir1/moreFiles/DnTFT3BWwAEslk6.jpg',
            '/r/dir1/mittens.jpg',
            '/r/dir1/hello.txt',
            '/r/dir1/grey-fur-kitten-127028.jpg',
            '/r/dir1/close-up-of-cat-248280.jpg'
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(moveCount, 1)
      })

      it('copy a file', async function () {
        const path = './test/fixtures/folderWithFiles/mittens.jpg'
        let updatedCount = 0
        let uploadCount = 0
        let copyCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('copy', () => copyCount++)

        await sharedfs1.upload('/r', globSource(path))
        assert.strict.deepEqual(sharedfs1.fs.tree('/r'), ['/r/mittens.jpg'])
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(copyCount, 0)

        await sharedfs1.copy('/r/mittens.jpg', '/r', 'file1')
        assert.strict.deepEqual(
          sharedfs1.fs.tree('/r'),
          ['/r/file1', '/r/mittens.jpg']
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(copyCount, 1)
      })

      it('copy a directory', async function () {
        const path = './test/fixtures/folderWithFiles'
        let updatedCount = 0
        let uploadCount = 0
        let copyCount = 0
        sharedfs1.events.on('updated', () => updatedCount++)
        sharedfs1.events.on('upload', () => uploadCount++)
        sharedfs1.events.on('copy', () => copyCount++)

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
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 1)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(copyCount, 0)

        await sharedfs1.copy('/r/folderWithFiles', '/r', 'dir1')
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
            '/r/folderWithFiles/close-up-of-cat-248280.jpg',
            '/r/dir1',
            '/r/dir1/moreFiles',
            '/r/dir1/moreFiles/hamlet.txt',
            '/r/dir1/moreFiles/DnTFT3BWwAEslk6.jpg',
            '/r/dir1/mittens.jpg',
            '/r/dir1/hello.txt',
            '/r/dir1/grey-fur-kitten-127028.jpg',
            '/r/dir1/close-up-of-cat-248280.jpg'
          ].sort(sortFn)
        )
        assert.strict.equal(updatedCount, 2)
        assert.strict.equal(uploadCount, 1)
        assert.strict.equal(copyCount, 1)
      })

      it('exposes db load.progress', async function () {
        let expectedCount = 0
        // upload a directory
        const path = './test/fixtures/folderWithFiles'
        await sharedfs1.upload('/r', globSource(path, { recursive: true }))
        expectedCount++

        // make a directory
        await sharedfs1.mkdir('/r', 'dirname')
        expectedCount++

        // make a file
        await sharedfs1.mkfile('/r', 'filename')
        expectedCount++

        // write to a file
        await sharedfs1.write('/r/filename', file1.cid)
        expectedCount++

        // reopen sharedfs1
        await sharedfs1.stop()
        sharedfs1 = await sailplane1.mount(address1, { Crypter, autoStart: false })

        let loadProgressCount = 0
        sharedfs1.events.on('db.load.progress', () => loadProgressCount++)
        await sharedfs1.start()
        assert.strict.equal(loadProgressCount, expectedCount)
      })

      it('exposes db access', async function () {
        assert.strict.equal(Boolean(sharedfs1.access), true)
        assert.strict.equal(sharedfs1.access._ac, sharedfs1._db.access)
      })

      it('exposes db identity', async function () {
        assert.strict.equal(sharedfs1.identity, sharedfs1._db.identity)
      })
    })
  })
})
