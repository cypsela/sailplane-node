
'use strict'

const secondLast = async (iterator) => {
  const res = []

  for await (const entry of iterator) {
    if (res[0]) res[1] = res[0]
    res[0] = entry
  }

  return res.length === 2 ? res[1] : res[0]
}

module.exports = {
  secondLast
}
