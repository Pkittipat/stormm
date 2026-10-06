# Reading a storm as design

A finished storm is the domain design: the aggregates (with their invariants) are the **domain model**, the commands and events (with their fields) are its **interface**, and actors, read models and policies are its **usage**. Only how it's built is left to the project.

## The YAML (schema v1)

```yaml
schemaVersion: 1
id: publish-job            # process id, a slug
name: Publish Job
blocks:
  - id: publish-job        # stable slug; renames change the title, never the id
    kind: command          # readmodel | command | aggregate | system | event | policy
    title: Publish Job     # the business name
    actor: Recruiter       # optional: who does it
    invariants: [ "…" ]    # optional, aggregates only: rules it always protects, in plain words
    hotspots: [ "…" ]      # optional: open questions
    fields:                # optional: { name, type }, type is free text (string, time, Address, Item[]…)
      - { name: jobId, type: string }
connections:
  - { from: publish-job, to: job }   # directed, between block ids
```

Match blocks by `id`, never by title. Two versions of a storm describe the same thing when the ids are equal.

## What each sticky designs

| Sticky | Part of the design | What the business is saying | What the implementation must do |
|---|---|---|---|
| **command** | interface: an operation (input) | Someone (the actor) intends to do something. | Let that actor express the intention with the data in its fields. It may be refused. |
| **aggregate** | model | This is where the rules live that decide whether an intention is allowed. Things inside it stay consistent together. | Decide the commands it handles, protect its rules, and produce the events that follow. |
| **system** (external system) | model: outside the domain | Something the business doesn't own (a payment provider, an email service, another team's system) decides this command. | Hand the command to that system through the project's existing integration (or a port for one), and turn its answer into the event. Its rules are not ours to implement. |
| **event** | interface: a fact announced (output) | This fact happened and matters to the business. Past tense; it can't be undone. | Record or announce the fact with the data in its fields, so others can react. |
| **policy** | usage: automatic | Whenever this happens, the business does that. A standing rule of reaction. | React to the event by issuing the command, without someone having to ask. |
| **read model** | usage: the read path, what a user sees to decide | Someone needs to see this to make a decision. | Expose exactly its fields, read-only. See [Read models](#read-models). |
| **invariant** (on an aggregate) | model: a rule | This is always true for this aggregate, e.g. "A job can only be published once". | Refuse any command that would break it, the project's way, with a test for each rule. |
| **hotspot** | an undecided part of the design | Nobody knows the answer yet. | Don't answer it silently. |
| **fields** | the interface's data | The data that belongs to the sticky, in business terms. | Carry that data. Types are free text: map them to the project's types. |

## Read models

A read model is the **read path** of the design, and the counterpart of the commands: commands change things, read models only show them. Typical ones are *Job Detail* (one thing), *Job List* (many), and *Notification Count* (a summary).

- **Its fields are what gets exposed.** *Job Detail { jobId, position, status, … }* means "this is what the user sees about a job": the shape of what the read path returns, no more and no less. Don't expose the aggregate's other data because it's there. Don't drop a field because it's hard to get; raise that instead.
- **It changes nothing.** No rules, no events, no side effects. If the project separates the read path from the write (command) path, a read model belongs on the read side, the project's way.
- **It leads to the next action.** `read model → command` means the user looks at this and decides to act. The actor who sees it is the command's actor. What the command needs to identify its target (e.g. `jobId`) normally comes from what the read model shows. If it doesn't, that's a gap.
- **Where its data comes from:** `event → read model` arrows say which facts change it. With no such arrow, the storm only says what is shown, not how it's kept. Read it from data the project already has, and don't add a new write path for it.
- **What it doesn't say:** how the user asks for it, such as which id, filters, sorting or paging for a list. An obvious lookup (a detail by its id) is fine. Anything more is a question.

## What each arrow designs

The storm reads left to right: `read model → command → aggregate → event → policy → command`, and `event → read model`. An external system stands where an aggregate would: `command → system → event`.

| Arrow | Reads as | What it designs |
|---|---|---|
| read model → command | *Job Detail feeds Publish Job* | The actor decides to publish while looking at the job's detail. |
| command → aggregate | *Job handles Publish Job* | Job's rules decide whether publishing is allowed. |
| aggregate → event | *Job records Job Published* | When it is allowed, the fact "Job Published" results. |
| command → system | *Payment Gateway handles Charge Card* | Another system, not our rules, decides this command. |
| system → event | *Payment Gateway records Card Charged* | That system's answer comes back as this fact. |
| event → policy | *Job Published triggers Log activity* | That fact sets off a business reaction. |
| policy → command | *Log activity sends Create Activity Log* | The reaction is this intention, issued automatically. |
| event → read model | *Job Published updates Job Detail* | The fact changes what people see. |

An arrow outside this grammar (`check` warns about it) means something the storm's author had in mind. Ask what before coding it.

## What the design leaves open

Treat these as questions for the user, not decisions for you:

- **Rules beyond the invariants:** an aggregate's `invariants` are its rules, and only those. Implement each one and don't add others. If an aggregate lists none, the storm doesn't say when it refuses a command: ask.
- **Which command an invariant applies to:** read it from the sentence ("…can only be *published* once" guards Publish Job). If it isn't clear, ask.
- **Rules that need data from outside the aggregate** (e.g. "a recruiter has at most 10 open jobs" on Job): that's a question about the aggregate's boundary. Raise it; don't quietly read other data to enforce it.
- **What state enforces a rule:** the aggregate keeps only what its invariants and events need.
- **Which command leads to which event** when one aggregate handles several commands and records several events.
- **Where a read model's information comes from** when no event updates it.
- **What decides a command** that leads to no aggregate or external system (a gap in the storm).
- **Anything not drawn:** no arrow means no relationship. Don't add one because it seems natural.
- **How any of it is built:** that's the project's.
