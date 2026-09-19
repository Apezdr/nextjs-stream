// Production build with Next's testing API compiled in, for the instant() specs.
// The flag has to be present at build time; setting it for `next start` is too late.
import { spawnSync } from 'node:child_process'

const result = spawnSync('npx', ['next', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, EXPOSE_TESTING_API: '1' },
})
process.exit(result.status ?? 1)
