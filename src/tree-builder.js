'use strict'

const util = require('./util')
const conflictError = () => new Error('conflict while building upload tree')
const emptyDir = () => ({ children: {} })

module.exports = async function (source) {
  const tree = emptyDir()
  for await (const object of source) {
    const isFile = Boolean(object.content)
    const pathNames = util.removeSlash(object.path).split('/')
    const lastDir = pathNames.slice(0, isFile ? -1 : pathNames.length)
      .reduce((dir, name) => {
        const exists = dir.children[name]
        if (exists && exists.content) throw conflictError()
        if (!exists) dir.children[name] = emptyDir()
        return dir.children[name]
      }, tree)
    if (isFile) lastDir.children[pathNames[pathNames.length - 1]] = object
  }

  function traverse (dir = tree, path = '') {
    return Object.keys(dir.children).sort(util.sortFn)
      .reduce((array, c) => {
        const child = dir.children[c]
        const childPath = `${path}/${c}`
        return array.concat(
          child.content ? child : [{ path: childPath }, ...traverse(child, childPath)]
        )
      }, [])
  }

  return { traverse }
}
