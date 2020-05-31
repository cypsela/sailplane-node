# sailplane-node
share folders and files directly

This package was built to enable collaborative file storage similar to popular consumer faced cloud storage. It uses a custom orbit-db store named [orbit-db-fsstore](https://github.com/tabcat/orbit-db-fsstore) to map **file** paths to [IPFS content ids](https://docs.ipfs.io/concepts/content-addressing/) and calculates **directory** paths from contained file content ids.

#### Things to Note:
- This is alpha software, the API is likely to change.
- This is not yet a hardened protocol. Malicious entries added to the underlying orbitdb store could crash the program.
- The orbitdb instance handed to SailplaneNode must use js-ipfs version 0.41+ (requires the async iterator api)

### Install
```
npm install @tabcat/orbit-db-fsstore
```

# API
*check out [./test](./test) for examples*
## SailplaneNode API
### .create(orbitdb, [options])
`static` `async`

**orbitdb: an instance of [OrbitDB](https://github.com/orbitdb/orbit-db)**
**[options]: *{Object}*** options to be used by the sailplane instance; no options defined yet
```js
const sailplane = await Sailplane.create(orbitdb, {})
```
> returns a Promise that resolves to an instance of SailplaneNode

### .determineAddress(name, [options])
`async`

**name: *{String}*** naming the orbitdb filesystem store
**[options]: *{Object}*** options passed to [orbitdb.determineAddress](https://github.com/orbitdb/orbit-db/blob/master/API.md#orbitdbdetermineaddressname-type-options)
```js
const address = await sailplane.determineAddress('superdrive', {})
```
> returns a Promise that resolves to an instance of [OrbitDBAddress](https://github.com/orbitdb/orbit-db/blob/master/src/orbit-db-address.js) for an [FSStore](https://github.com/tabcat/orbit-db-fsstore)

### .mount(address, [options])
`async`

**address: *{OrbitDBAddress or String}*** address of an [FSStore](https://github.com/tabcat/orbit-db-fsstore)
**[options]: *{Object}*** options passed to [orbitdb.open](https://github.com/orbitdb/orbit-db/blob/master/API.md#orbitdbopenaddress-options) and [SharedFS.create](#)
```js
const sharedfs = await sailplane.mount(address, {})
```
> returns a Promise that resolves to an instance of SharedFS

## SharedFS API
### .create(fsstore, [options])
`static` `async`

##### This method should not be directly called by users, use [sailplane.mount](#mountaddress-options) instead

**fsstore**: an instance of [FSStore](https://github.com/tabcat/orbit-db-fsstore)
**[options]: *{Object}*** options to be used by the sharedfs instance
**[options.onStop]: *{Function}*** called and awaited before the sharedfs instance is stopped with [sharedfs.stop](). Used by [sailplane.mount](#mountaddress-options). `Default is empty function`
**[options.autoStart]: *{Boolean}*** whether to await sharedfs.start before returning sharedfs instance. `Default: true`
**[options.loadDb]: *{Boolean}*** whether calling sharedfs.start should load the fsstore history. `Default: true`
```js
const sharedfs = await SharedFS.create(orbitdb, {})
```
> returns a Promise that resolves to an instance of SharedFS

### .start()
`async`

Starts the sharedfs instance. Depending on sharedfs.options start may be called automatically and load fsstore history.
```js
await sharedfs.start()
```
> returns a Promise that resolves to undefined

### .stop([options])
`async`

**[options]: *{Object}*** options to be used
**[options.drop]: *{Boolean}*** whether to call [.drop](https://github.com/orbitdb/orbit-db/blob/master/API.md#storedrop) on the fsstore

Stops the sharedfs instance. Using the sharedfs instance after calling .stop could result in an error.
```js
await sharedfs.stop()
```
> returns a Promise that resolves to undefined

### .upload(path, source)
`async`

**path: *{String}*** a string usable as an [fsstore path](https://github.com/tabcat/orbit-db-fsstore). Every path must be a child of '/r'.
**source: *{data source}*** this is handed directly to [ipfs.add](https://github.com/ipfs/js-ipfs/blob/master/docs/core-api/FILES.md#ipfsadddata-options)

Upload folders and files to ipfs and add references to them in the fsstore.
```js
await sharedfs.upload('/r', source)
```
> returns a Promise that resolves to undefined

### .read(path)
`async`

**path: *{String}*** path of filesystem to read

```js
const cid = await sharedfs.read('/r')
```
> returns a Promise that resolves to an instance of [CID](https://github.com/multiformats/js-cid), more info about [IPFS content ids](https://docs.ipfs.io/concepts/content-addressing/)

### .remove(path)
`async`

**path: *{String}*** path of filesystem to remove

Removes a file or folder recursively at path.
```js
await sharedfs.remove('/r')
```
> returns a Promise that resolves to undefined

### .fs.joinPath(path, name)
Creates a new path by adding path and name
**[documentation](https://github.com/tabcat/orbit-db-fsstore#joinpathpath-name)**

### .fs.exists(path)
Returns whether path exists in filesystem
**[documentation](https://github.com/tabcat/orbit-db-fsstore#existspath)**

### .fs.content(path)
Returns content type at path
**[documentation](https://github.com/tabcat/orbit-db-fsstore#contentpath)**

### .fs.read(path)
Returns data stored path
**[documentation](https://github.com/tabcat/orbit-db-fsstore#readpath)**

### .fs.tree(path)
Returns all paths under path
**[documentation](https://github.com/tabcat/orbit-db-fsstore#treepath)**

### .fs.ls(path)
Returns all paths directly under path
**[documentation](https://github.com/tabcat/orbit-db-fsstore#lspath)**
