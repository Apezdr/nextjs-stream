import fs from 'node:fs'
import path from 'node:path'

describe('admin server telemetry UI contract', () => {
  it('renders network and GPU details in both full and compact resource views', () => {
    const enhanced = fs.readFileSync(
      path.join(process.cwd(), 'src/components/Admin/Stats/EnhancedServerStats.js'),
      'utf8'
    )
    const compact = fs.readFileSync(
      path.join(process.cwd(), 'src/components/Admin/Stats/ServerStats.js'),
      'utf8'
    )

    expect(enhanced).toContain('Network Throughput')
    expect(enhanced).toContain('App container traffic')
    expect(enhanced).toContain('GPU Status')
    expect(enhanced).toContain('temperatureC')
    expect(enhanced).toContain('ArrowsUpDownIcon')
    expect(enhanced).toContain('GpuVendorIcon')
    expect(enhanced).toContain('formatVram(gpu.memoryUsedMiB)')
    expect(enhanced).not.toContain('MiB`')
    expect(enhanced).toContain('CpuVendorIcon')
    expect(enhanced).toContain('TelemetrySparkline')
    expect(enhanced).toContain('Disk Utilization')
    expect(enhanced).toContain('CPU temperature')
    expect(enhanced).toContain('Active logical processors')
    expect(enhanced).toContain('Installed hardware')
    expect(enhanced.indexOf('Network Throughput')).toBeLessThan(enhanced.indexOf('CPU Usage'))
    expect(compact).toContain("network?.state === 'available'")
    expect(compact).toContain("['available', 'partial', 'stale'].includes(gpus?.state)")
    expect(compact.indexOf("network?.state === 'available'")).toBeLessThan(compact.indexOf('{/* CPU Bar */}'))
    expect(compact).toContain('order-4')
    expect(compact).toContain('order-5')
  })

  it('keeps the existing three-second SWR cadence instead of adding a poller', () => {
    // Both views share SWR's key-level request deduplication; changing the key
    // or adding a second endpoint would multiply background server work.
    for (const relativePath of [
      'src/components/Admin/Stats/EnhancedServerStats.js',
      'src/components/Admin/Stats/ServerStats.js',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
      expect(source).toContain("'/api/authenticated/admin/server-load'")
      expect(source).toContain('refreshInterval: 3000')
    }
  })
})