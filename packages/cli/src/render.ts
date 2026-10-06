import type { Issue } from '@stormm/process-model'
import type { Contract, Unit } from './contract.js'

const PLURAL = { command: 'Commands', aggregate: 'Aggregates', event: 'Events', policy: 'Policies', readmodel: 'Read models', system: 'External systems' } as const

const fieldList = (u: Unit) => (u.fields.length ? u.fields.map((f) => `${f.name}: ${f.type}`).join(', ') : '—')

export function unitLine(u: Unit) {
  const extra = [u.actor && `actor ${u.actor}`, u.invariants.length && `invariants: ${u.invariants.join(' / ')}`, `fields ${fieldList(u)}`, u.hotspots.length && `hotspots: ${u.hotspots.join(' / ')}`].filter(Boolean)
  return `${u.title} — \`${u.names.pascal}\` (id \`${u.id}\`; ${extra.join('; ')})`
}

/** The storm for an engineer's agent: its units, what connects them, one slice per command, and what it leaves open. */
export function renderExplain(c: Contract, issues: Issue[]) {
  const unit = new Map(c.units.map((u) => [u.id, u]))
  const title = (id: string) => unit.get(id)!.title
  const out: string[] = [`# ${c.name}`, '', `Process id \`${c.id}\` · ${c.units.length} units · ${c.arrows.length} arrows`, '']

  out.push('## Issues', '')
  out.push(...(issues.length ? issues.map((i) => `- ${i.level}: ${i.message}`) : ['- none']), '')

  out.push('## Units', '')
  for (const kind of ['command', 'aggregate', 'system', 'event', 'policy', 'readmodel'] as const) {
    const us = c.units.filter((u) => u.kind === kind)
    if (!us.length) continue
    out.push(`**${PLURAL[kind]}**`, '', ...us.map((u) => `- ${unitLine(u)}`), '')
  }

  out.push('## Arrows', '', ...(c.arrows.length ? c.arrows.map((a) => `- ${a.text}`) : ['- none']), '')

  // A slice follows one command through the storm: what feeds it, what decides it, what it records, and what reacts.
  const commands = c.units.filter((u) => u.kind === 'command')
  if (commands.length) out.push('## Slices', '')
  for (const cmd of commands) {
    const l = cmd.links
    out.push(`### ${cmd.title}${cmd.actor ? ` (by ${cmd.actor})` : ''}`, '')
    if (l.sentBy) out.push(`- sent by policy: ${l.sentBy.map(title).join(', ')}`)
    if (l.fedBy) out.push(`- fed by read model: ${l.fedBy.map(title).join(', ')}`)
    if (!l.handledBy) out.push('- handled by: no aggregate or external system in the storm')
    for (const aggId of l.handledBy ?? []) {
      const agg = unit.get(aggId)!
      out.push(`- handled by ${agg.kind === 'system' ? 'external system' : 'aggregate'}: ${agg.title}`)
      for (const evId of agg.links.records ?? []) {
        const ev = unit.get(evId)!
        out.push(`  - records event: ${ev.title}`)
        for (const polId of ev.links.triggers ?? []) {
          const pol = unit.get(polId)!
          const sends = pol.links.sends?.map(title).join(', ')
          out.push(`    - triggers policy: ${pol.title}${sends ? ` → sends ${sends}` : ''}`)
        }
        for (const rmId of ev.links.updates ?? []) out.push(`    - updates read model: ${title(rmId)}`)
      }
    }
    out.push('')
  }

  // The read side: what each read model exposes, to whom, what it leads them to do, and where its data comes from.
  const readModels = c.units.filter((u) => u.kind === 'readmodel')
  if (readModels.length) out.push('## Read side', '')
  for (const rm of readModels) {
    const l = rm.links
    const leadsTo = (l.feeds ?? []).map((id) => unit.get(id)!)
    const actors = [...new Set(leadsTo.flatMap((cmd) => (cmd.actor ? [cmd.actor] : [])))]
    out.push(`### ${rm.title}`, '')
    out.push(`- exposes: ${rm.fields.length ? rm.fields.map((f) => `${f.name}: ${f.type}`).join(', ') : 'no fields yet (the storm doesn\'t say what is shown)'}`)
    if (actors.length) out.push(`- seen by: ${actors.join(', ')}`)
    out.push(`- leads to: ${leadsTo.length ? leadsTo.map((cmd) => cmd.title).join(', ') : 'no command (information only)'}`)
    out.push(`- data from: ${l.updatedBy ? l.updatedBy.map(title).join(', ') : 'not stated (no event updates it)'}`)
    out.push('')
  }

  out.push('## Gaps', '', ...(c.gaps.length ? c.gaps.map((g) => `- ${g}`) : ['- none']), '')
  return out.join('\n')
}
