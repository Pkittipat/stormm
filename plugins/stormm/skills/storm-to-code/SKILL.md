---
name: storm-to-code
description: Process modeling coding. A finished Stormm event storm is already the domain design (the domain model, its interface, and how it is used), so implement that design in the project's own way instead of designing the domain again. Use when the user points at a storm or process YAML (schemaVersion + blocks + connections with kinds readmodel/command/aggregate/system/event/policy), asks to implement or change code from an event storm or process model, asks what a change in the storm means for the code, or asks whether the code still matches the storm. Works for any language and architecture.
---

# Storm to code

**Process modeling coding:** once the event storm is done, the domain is already designed. The storm isn't a loose description to interpret; it *is* the design.

- **The domain model:** the aggregates, the boundaries where rules keep things consistent, and their invariants, the rules themselves.
- **The domain interface:** the commands (what can be asked of the model, with their fields as input) and the events (what the model announces, with their fields as output).
- **The usage:** who uses the interface (the command's actor), from what information (read models), and what uses it automatically in reaction to other facts (policies).

What the storm leaves open is **how** it's built: architecture, patterns, frameworks, persistence, naming style and tests. That belongs to each project, and you learn it from the code already there and its docs (`CLAUDE.md`, `AGENTS.md`, READMEs, ADRs).

So your job is to **implement the storm's design the project's way**. Don't design the domain again, and don't bring a code structure from elsewhere. [references/meaning.md](references/meaning.md) explains how to read each sticky and arrow as design.

## Principles

1. **The storm is the domain design; implement it, don't redesign it.** The domain's concepts, operations, facts, data and reactions are the ones in the storm, no more and no fewer. Every domain behavior you write must trace to a sticky or an arrow. Don't add domain behavior the storm doesn't show: an extra reaction, a rule, a field, a flow of data. Technical work the project needs to make the design real (wiring, persistence, transport) is fine; that's the engineers' part.
2. **The project decides the code.** Before writing, find how this project already does the same kind of thing: an existing use case, rule, event, reaction or view. Do it the same way. Don't bring a structure, pattern or layering from elsewhere. If the project has no precedent for something, propose the smallest approach that fits and ask.
3. **Speak the storm's language.** Use the storm's words for the concepts in code, in the project's own casing and style, so a domain expert and an engineer can point at the same thing. A renamed sticky means renamed code.
4. **Gaps are questions, not guesses.** Hotspots, rules the storm doesn't state, commands nothing decides, views with no source of data: surface them before coding and let the user decide. If the user wants code anyway, mark the gap in the project's usual way (e.g. a TODO naming the storm) instead of inventing an answer.
5. **The storm changes first.** When the code needs something the storm doesn't have, suggest the change to the storm. Never edit the storm yourself to make room for code.
6. **Leave a trail.** At the end, say how the storm maps to what you wrote and what's still open, so the next change starts from the storm.

## Read the YAML itself

The `.yaml` file is the design, so always read it directly and take its meaning from there. Don't substitute a summary, including one you or a tool produced earlier. When anything seems off, go back to the file. [references/meaning.md](references/meaning.md) explains how to read it.

The plugin ships two small helpers (Node 20+). Neither interprets the storm:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/stormm.mjs" check <process.yaml>                    # is it valid? same rules as the Stormm app
node "${CLAUDE_PLUGIN_ROOT}/scripts/stormm.mjs" changes <process.yaml> --since <git-ref> # what differs since that commit, by block id
```

- **`check`** prints the validator's errors and warnings exactly as the Stormm app reports them. On errors (unknown kind, a connection to a missing block…) show them to the user and stop: they must be fixed in the storm.
- **`changes`** lists what differs between the two versions of the file, matched by block id, in the YAML's own terms: blocks added, removed or changed (title, kind, actor, fields, hotspots) and connections added or removed. Matching by id is what tells a rename from a delete-and-add. It is a list of differences, not the design: read the current YAML for the meaning. Add `--json` for the raw diff.

Without Node, read the YAML carefully and compare versions yourself with `git show <ref>:<path>`, matching blocks by `id`.

## Where storms live

In a repository, storms live in the `.stormm/` folder at its root, one process per file (e.g. `.stormm/publish-job.yaml`), committed with the code. If you can't find the storm the user means, ask.

## Working from a storm

1. **Read the design** from the YAML (run `check` first if you can). Restate it briefly:
   - the model (aggregates and their invariants)
   - its interface (commands in, events out, with their fields)
   - its usage (actors, read models and what they expose, policies)

   Work a slice at a time: one command and everything that follows from it.
2. **Learn how the project builds.** Read enough of the codebase to know how it already expresses a domain model, its operations and events, reactions and views, and how it tests them. Don't assume a pattern; find one.
3. **Raise the gaps** before writing ([references/meaning.md](references/meaning.md) lists what a storm leaves open), and agree with the user how to handle each.
4. **Implement the design** the project's way, in the storm's language, with the project's kind of tests for the behavior the storm describes.
5. **Verify** with the project's own build, lint and test commands.
6. **Report** which part of the code carries each sticky and arrow, what you left open, and anything you'd suggest adding to the storm.

## When the storm changes

The code already exists, so don't start over. Run `changes --since <ref>`, where `<ref>` is the commit the code last matched. Ask if it isn't clear; the last commit touching both the storm and the code is a good guess. Then read the current YAML for what each difference means, find the code that carries it, and change it the project's way:
- a new title means renamed code
- a new or removed connection means a new or removed behavior
- a changed field means changed data
- a removed hotspot means a decision to write in (ask what was decided if the storm doesn't show it)

## Checking code against a storm

Go through the storm's stickies and arrows and find the code that carries each one. Report three lists:
- what the storm has that the code doesn't
- business behavior in the code that the storm doesn't show
- names that drifted from the storm's words

Don't change code during a check unless the user asks.
