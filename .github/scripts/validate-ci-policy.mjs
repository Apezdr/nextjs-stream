import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const repositoryRoot = process.cwd()
const workflowDirectory = path.join(repositoryRoot, '.github', 'workflows')
const failures = []

const expectedInstallScripts = new Map([
  ['node_modules/fsevents', { version: '2.3.3', os: ['darwin'] }],
  ['node_modules/protobufjs', { version: '8.0.1' }],
  ['node_modules/sharp', { version: '0.34.5' }],
  ['node_modules/unrs-resolver', { version: '1.11.1' }],
])

const lockfile = JSON.parse(await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8'))
const packagesWithInstallScripts = Object.entries(lockfile.packages ?? {})
  .filter(([, packageMetadata]) => packageMetadata.hasInstallScript)
  .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))

for (const [packagePath, packageMetadata] of packagesWithInstallScripts) {
  const expected = expectedInstallScripts.get(packagePath)
  if (!expected) {
    failures.push(`Unreviewed dependency install script: ${packagePath}@${packageMetadata.version}`)
    continue
  }

  if (packageMetadata.version !== expected.version) {
    failures.push(
      `Install-script version changed for ${packagePath}: expected ${expected.version}, found ${packageMetadata.version}`,
    )
  }

  if (expected.os) {
    const actualOperatingSystems = [...(packageMetadata.os ?? [])].sort()
    if (JSON.stringify(actualOperatingSystems) !== JSON.stringify([...expected.os].sort())) {
      failures.push(
        `Install-script OS constraint changed for ${packagePath}: expected ${expected.os.join(',')}`,
      )
    }
  }
}

for (const packagePath of expectedInstallScripts.keys()) {
  if (!packagesWithInstallScripts.some(([actualPath]) => actualPath === packagePath)) {
    failures.push(`Reviewed install-script dependency is missing from the lockfile: ${packagePath}`)
  }
}

const workflowFileNames = (await readdir(workflowDirectory))
  .filter((fileName) => /\.ya?ml$/i.test(fileName))
  .sort()

if (workflowFileNames.length === 0) {
  failures.push('No GitHub Actions workflow files were found')
}

const actionReferencePattern = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm

for (const workflowFileName of workflowFileNames) {
  const workflowPath = path.join(workflowDirectory, workflowFileName)
  const workflowSource = await readFile(workflowPath, 'utf8')

  for (const match of workflowSource.matchAll(actionReferencePattern)) {
    const actionReference = match[1]
    if (actionReference.startsWith('./')) continue

    if (!/^[^@\s]+@[0-9a-f]{40}$/.test(actionReference)) {
      failures.push(`${workflowFileName} uses a mutable action reference: ${actionReference}`)
    }
  }
}

const pullRequestWorkflowName = 'pr-validation.yml'
const pullRequestWorkflowPath = path.join(workflowDirectory, pullRequestWorkflowName)
const pullRequestWorkflow = await readFile(pullRequestWorkflowPath, 'utf8')
const forbiddenPatterns = [
  [/pull_request_target\s*:/, 'must not use the privileged pull request target event'],
  [/\$\{\{\s*secrets\./, 'must not consume repository secrets'],
  [/^\s+[\w-]+:\s*write\s*(?:#.*)?$/m, 'must not grant write permissions'],
  [/\bnpx\s+/, 'must not download tools dynamically with npx'],
  [/\bnpm\s+install(?:\s|$)/m, 'must use npm ci instead of npm install'],
  [/\bnpm\s+update(?:\s|$)/m, 'must not update dependencies'],
  [/\bnpm\s+audit\s+fix(?:\s|$)/m, 'must not rewrite dependencies with npm audit fix'],
  [/\bnpm\s+run\s+lint(?:\s|$)/m, 'must not invoke the mutating local lint script'],
  [/\bknip\s+--fix(?:\s|$)/m, 'must not run Knip in fix mode'],
  [/\bknip:fix\b/, 'must not invoke the Knip fix script'],
  [/remove-dead-functions/, 'must not invoke the destructive dead-code script'],
]

for (const [pattern, description] of forbiddenPatterns) {
  if (pattern.test(pullRequestWorkflow)) {
    failures.push(`${pullRequestWorkflowName} ${description}`)
  }
}

if (!/^\s{2}pull_request:\s*$/m.test(pullRequestWorkflow)) {
  failures.push(`${pullRequestWorkflowName} must run on pull_request`)
}

if (!/^permissions:\s*\r?\n\s{2}contents:\s*read\s*$/m.test(pullRequestWorkflow)) {
  failures.push(`${pullRequestWorkflowName} must set top-level permissions to contents: read`)
}

const checkoutCount = [...pullRequestWorkflow.matchAll(/uses:\s*actions\/checkout@/g)].length
const credentialOptOutCount = [...pullRequestWorkflow.matchAll(/persist-credentials:\s*false/g)].length
if (credentialOptOutCount < checkoutCount) {
  failures.push(`${pullRequestWorkflowName} must disable persisted credentials for every checkout`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`ERROR: ${failure}`)
  process.exit(1)
}

console.log(
  `CI policy passed: ${workflowFileNames.length} workflow(s), ${packagesWithInstallScripts.length} reviewed install script(s)`,
)