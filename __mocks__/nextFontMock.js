module.exports = new Proxy(
  {},
  {
    get: function getter(target, prop) {
      if (prop === '__esModule') {
        return false
      }
      return () => ({ className: '', style: { fontFamily: '' } })
    },
  },
)
