import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBoard, type Board } from '@stormm/process-model'
import { describe, expect, it } from 'vitest'
import { buildContract, changes, names, renderChanges } from '../src'

const PUBLISH_JOB = readFileSync(new URL('./publish-job.yaml', import.meta.url), 'utf8')
const board = (yaml: string): Board => {
  const { board, issues } = parseBoard(yaml)
  if (!board) throw new Error(JSON.stringify(issues))
  return board
}

describe('names', () => {
  it('gives every casing from a title', () => {
    expect(names('Whenever job created, log the activity')).toEqual({
      pascal: 'WheneverJobCreatedLogTheActivity',
      camel: 'wheneverJobCreatedLogTheActivity',
      snake: 'whenever_job_created_log_the_activity',
      kebab: 'whenever-job-created-log-the-activity',
    })
  })
})

describe('buildContract', () => {
  const c = buildContract(board(PUBLISH_JOB))
  const unit = (id: string) => c.units.find((u) => u.id === id)!

  it('names each connection from both ends', () => {
    expect(unit('publish-job').links).toEqual({ fedBy: ['job-detail'], handledBy: ['job'] })
    expect(unit('job').links).toEqual({ handles: ['publish-job'], records: ['job-published'] })
    expect(unit('job-published').links.triggers).toHaveLength(2)
    expect(c.arrows.map((a) => a.text)).toContain('Job handles Publish Job')
  })

  it('reports what the storm leaves open', () => {
    expect(c.gaps).toContain('Command "Notify Member" is not handled by any aggregate or external system: the storm doesn\'t say what decides it or which event it records.')
  })

  it('reads an external system like an aggregate it doesn\'t own', () => {
    const b = board(PUBLISH_JOB)
    b.blocks.push(
      { id: 'mailer', kind: 'system', title: 'Mailer', invariants: [], hotspots: [], fields: [] },
      { id: 'member-notified', kind: 'event', title: 'Member Notified', invariants: [], hotspots: [], fields: [{ name: 'memberId', type: 'ID' }] },
    )
    b.connections.push({ from: 'notify-member', to: 'mailer' }, { from: 'mailer', to: 'member-notified' })
    const sc = buildContract(b)
    expect(sc.units.find((u) => u.id === 'mailer')!.links).toEqual({ handles: ['notify-member'], records: ['member-notified'] })
    expect(sc.arrows.map((a) => a.text)).toEqual(expect.arrayContaining(['Mailer handles Notify Member', 'Mailer records Member Notified']))
    expect(sc.gaps.filter((g) => !g.startsWith('Hotspot') && /Notify Member|Mailer|Member Notified/.test(g))).toEqual([])
  })
})

describe('changes', () => {
  const after = board(PUBLISH_JOB)

  it('treats a new storm as all added', () => {
    const d = changes(null, after)
    expect(d.blocks.added).toHaveLength(after.blocks.length)
    expect(d.connections.added).toHaveLength(after.connections.length)
  })

  it('reports a rename, a new field and a new connection in the YAML\'s own terms', () => {
    const before = board(PUBLISH_JOB)
    const event = before.blocks.find((b) => b.id === 'job-published')!
    event.title = 'Job Created'
    event.fields = event.fields.filter((f) => f.name !== 'publishedAt')
    before.connections = before.connections.filter((c) => c.to !== 'notify-organization-members')
    after.blocks.find((b) => b.id === 'job')!.invariants.push('A job can only be published once')
    const out = renderChanges(changes(before, after), before, after, 'v1')
    expect(out).toContain('- `job` (aggregate) Job\n  - invariant added: "A job can only be published once"')
    expect(out).toContain('- `job-published` (event) Job Published\n  - title: Job Created → Job Published\n  - field added: publishedAt: time')
    expect(out).toContain('## Connections added\n\n- `job-published` → `notify-organization-members` (Job Published → Notify organization members)')
    // Nothing the YAML doesn't say: no code names, no arrow wording.
    expect(out).not.toContain('JobPublished')
    expect(out).not.toContain('triggers')
  })
})

describe('the bundled CLI', () => {
  const cli = new URL('../../../plugins/stormm/scripts/stormm.mjs', import.meta.url).pathname

  it('explains a storm', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stormm-cli-'))
    writeFileSync(join(dir, 'p.yaml'), PUBLISH_JOB)
    const out = execFileSync('node', [cli, 'explain', join(dir, 'p.yaml')], { encoding: 'utf8' })
    expect(out).toContain('### Publish Job (by Recruiter)')
    expect(out).toContain('- handled by aggregate: Job')
    expect(out).toContain('### Job Detail\n\n- exposes: jobId: string, title: string, status: string, publishedAt: time\n- seen by: Recruiter\n- leads to: Publish Job\n- data from: not stated (no event updates it)')
  })

  it('diffs against a git ref', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stormm-cli-'))
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
    git('init', '-q')
    writeFileSync(join(dir, 'p.yaml'), PUBLISH_JOB.replace('title: Job Published', 'title: Job Created'))
    git('add', '.')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'storm')
    writeFileSync(join(dir, 'p.yaml'), PUBLISH_JOB)
    const out = execFileSync('node', [cli, 'changes', join(dir, 'p.yaml'), '--since', 'HEAD'], { encoding: 'utf8' })
    expect(out).toContain('  - title: Job Created → Job Published')
  })

  it('checks a storm', () => {
    const dir = mkdtempSync(join(tmpdir(), 'stormm-cli-'))
    writeFileSync(join(dir, 'p.yaml'), PUBLISH_JOB)
    expect(execFileSync('node', [cli, 'check', join(dir, 'p.yaml')], { encoding: 'utf8' })).toMatch(/^ok: .* is a valid storm \(8 blocks, 7 connections\)/)
    writeFileSync(join(dir, 'p.yaml'), PUBLISH_JOB.replace('kind: aggregate', 'kind: entity'))
    const failed = (() => {
      try {
        execFileSync('node', [cli, 'check', join(dir, 'p.yaml')], { stdio: 'pipe', encoding: 'utf8' })
      } catch (e) {
        return e as { status: number; stdout: string }
      }
    })()
    expect(failed?.status).toBe(1)
    expect(failed?.stdout).toMatch(/^error: Block “job” has unknown kind “entity”/)
  })
})
