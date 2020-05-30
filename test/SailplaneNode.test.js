
'use strict'

const assert = require('assert')
const rmrf = require('rimraf')
const path = require('path')
const OrbitDB = require('orbit-db')
const SailplaneNode = require('../src')

const {
  config,
  startIpfs,
  stopIpfs,
  testAPIs
} = require('orbit-db-test-utils')

const dbPath = './orbitdb/tests/sailplane-node'
const ipfsPath = './orbitdb/tests/sailplane-node/ipfs'

Object.keys(testAPIs).forEach(API => {
  describe(`Sailplane Node (${API})`, function () {
    this.timeout(config.timeout)

    let ipfsd, ipfs, orbitdb1, sailplane1, address1, sharedfs1

    before(async () => {
      config.daemon1.repo = ipfsPath
      rmrf.sync(config.daemon1.repo)
      ipfsd = await startIpfs(API, config.daemon1)
      ipfs = ipfsd.api
      orbitdb1 = await OrbitDB.createInstance(ipfs, { directory: path.join(dbPath, '1') })
    })

    after(async () => {
      if (sailplane1) {
        await sailplane1.stop()
      }

      if (orbitdb1) {
        await orbitdb1.stop()
      }

      if (ipfsd) {
        await stopIpfs(ipfsd)
      }
    })

    it('create an instance of Sailplane', async function () {
      sailplane1 = await SailplaneNode.create(orbitdb1)
    })

    it('determine sharedfs address', async function () {
      const config = { accessController: { write: ['*'] } }
      address1 = await sailplane1.determineAddress('sailplane-drive', config)
      assert.strict.equal(
        address1.toString(),
        '/orbitdb/zdpuAsTJLAXJQTYfG6qDNGmH7XphJ5QJX1uxcrrSvQPdNLVHv/sailplane-drive'
      )
    })

    it('mount a sharedfs', async function () {
      sharedfs1 = await sailplane1.mount(address1)
      assert.strict.equal(sharedfs1, sailplane1.mounted[address1])
    })
  })
})
