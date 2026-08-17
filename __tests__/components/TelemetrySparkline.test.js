import { buildSparklinePoints } from '@src/components/Admin/Stats/TelemetrySparkline'

describe('buildSparklinePoints', () => {
  test('uses a fixed percentage scale when provided', () => {
    expect(buildSparklinePoints([0, 50, 100], { width: 100, height: 20, maxValue: 100 }))
      .toBe('0.0,20.0 50.0,10.0 100.0,0.0')
  })

  test('uses an adaptive ceiling and omits unavailable samples', () => {
    expect(buildSparklinePoints([null, 2, 4, undefined], { width: 100, height: 20 }))
      .toBe('0.0,10.0 100.0,0.0')
    expect(buildSparklinePoints([null, undefined])).toBe('')
  })
})