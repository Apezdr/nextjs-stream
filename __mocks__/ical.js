const jest = require('jest')

const ical = jest.createMockFromModule('ical.js')

ical.parse = jest.fn().mockReturnValue([])
ical.Component = jest.fn().mockImplementation(() => ({
  getAllSubcomponents: jest.fn().mockReturnValue([
    {
      getFirstPropertyValue: jest.fn((prop) => {
        if (prop === 'summary') return 'Archer (2009) - 10x07 - Space Pirates'
        if (prop === 'dtstart' || prop === 'dtend') return { toJSDate: () => new Date() }
      }),
    },
    {
      getFirstPropertyValue: jest.fn((prop) => {
        if (prop === 'summary') return 'Barbarian (Theatrical Release)'
        if (prop === 'dtstart' || prop === 'dtend') return { toJSDate: () => new Date() }
      }),
    },
  ]),
}))

module.exports = ical
