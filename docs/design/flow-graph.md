# KVMFlow graph workflows

Status: implemented (schema v2). This document records the design and the decisions
taken while building it; the README describes day-to-day use.

## Problem

Schema v1 was a list of `steps`. Each step ran a precondition, an action and a
verification, and a failed step could only `pause`, `retry`, `continue` or `abort`.
That cannot express the screens KVM automation actually meets:

- "if the region page is showing, pick a region; if the network page is showing, skip it";
- "wait until the update spinner is gone, at most 15 minutes";
- "repeat until the desktop appears";
- "read the IP address from the screen and type it later".

## Goals and non-goals

Goals:

- Workflows are directed graphs with conditional branches, multi-way branches,
  waiting, loops (back edges), sub-workflows, operator choices and error routes.
- Nodes exchange data through variables, node outputs and run inputs.
- A canvas editor in the KVMFlow panel, with live highlighting while a run executes.
- The agent edits graphs with small patch operations instead of rewriting YAML.
- v1 workflows keep working and are upgraded automatically.

Non-goals for this version:

- Parallel branches. One KVM executes one HID stream; parallelism would be fake.
- Arbitrary scripts. Conditions use a small, side-effect-free expression language.
- An embedded agent node. Open-ended goals stay in the conversation, where the
  agent already has the `kvmflow_*` tools.

## Document model (schema v2)

```yaml
version: 2
name: Windows OOBE
inputs:
  username: { type: string, description: Local account name }
  password: { type: string, secret: true }
vars:
  attempts: 0
limits: { maxNodeVisits: 1000, timeoutSec: 3600 }
bios: { hotkey: F2 }          # optional, runs before `start`
start: detect                 # id of the first node
nodes:
  detect:
    type: vision_classify
    name: Which OOBE page?
    config:
      labels:
        region: Region selection page
        network: Network page
        desktop: Windows desktop
    maxVisits: 30
    next: { region: pick_region, network: skip_network, desktop: done, unknown: ask }
  ...
```

Decisions:

- **Edges live on the source node** (`next: { <port>: <target> }`). The YAML reads as
  "after this, go there", a change touches one place, and the agent cannot leave a
  dangling edge list behind.
- **Node ids and port names** match `[A-Za-z][A-Za-z0-9_-]*`, so they are safe as
  YAML keys and expression paths.
- **`start` is a document field**, not a node type. The canvas draws it as a Start pill;
  connecting the pill to a node changes `start`.
- **Canvas coordinates live in `<id>.layout.json`** beside the YAML. Moving a node never
  changes the workflow, and an agent edit never disturbs the layout.

## Node catalog

| Category | Type | Ports |
|---|---|---|
| Flow | `if` | `true`, `false` |
| | `switch` (ordered cases, first match wins) | one per case, `default` |
| | `wait_until` (poll a condition) | `ok`, `timeout` |
| | `loop` (count and/or while) | `body`, `done` |
| | `subflow` (call another workflow) | `success`, `failure` |
| | `human` (operator picks an option) | one per option |
| | `set` (assign variables) | `next` |
| | `end` (`success` or `failure`, optional outputs) | — |
| Action | `key`, `shortcut`, `text`, `click`, `move`, `scroll`, `delay`, `sequence` | `next`, `error` |
| Perception | `vision_check` | `true`, `false`, `error` |
| | `vision_classify` (one model call for an N-way branch) | one per label, `unknown`, `error` |
| | `vision_extract` (JSON fields into the output / a variable) | `next`, `error` |
| | `locate` (find an element, output frame-normalized `x`,`y`) | `found`, `not_found`, `error` |
| | `image_match` | `true`, `false`, `error` |
| | `screen_change` | `true`, `false`, `error` |

Action nodes keep v1's guards as fields instead of extra nodes: an optional
`precondition` and an optional `verify` (both are conditions with timing). A failed guard
or a failed HID call is a node failure. This keeps a recorded workflow as compact on the
canvas as it was in v1.

## Conditions and expressions

A condition is one of:

```yaml
{ vision: "A dialog titled Is this the right country or region is visible" }
{ image: assets/ref.jpg, maxByteDelta: 2000 }   # exact JPEG hash, or byte-size delta
{ change: true }                                # frame hash differs from the last frame
{ expr: "vars.attempts < 3 && nodes.detect.output.label == 'network'" }
{ all: [ ... ] }  { any: [ ... ] }  { not: { ... } }
```

Expressions are parsed by a small Pratt parser and evaluated over a frozen scope; there is
no `eval`. Supported: number/string/boolean/null literals, array literals, paths
(`vars.x`, `inputs.x`, `nodes.<id>.output.x`, `nodes.<id>.visits`, `last.x`, `run.visits`),
`[]` indexing, `! - + * / % == != < <= > >= && || ?:`, and the functions `len`,
`contains`, `startsWith`, `endsWith`, `lower`, `upper`, `trim`, `number`, `string`,
`round`, `floor`, `ceil`, `abs`, `min`, `max`, `coalesce`.

Every string in a node's config is a template: `"{{inputs.username}}"`. A string that is
exactly one `{{ … }}` keeps the value's type, so `x: "{{nodes.find.output.x}}"` is a number.
`expr` fields are expressions, not templates.

`image_match` compares the exact JPEG hash, optionally tolerating a byte-size delta, as v1
did. The Host has no JPEG decoder, so it does not claim perceptual similarity; use
`vision_check` for screens that move.

## Execution

The runner interprets the graph one node at a time:

```
node = start
loop
  check limits (node maxVisits, document maxNodeVisits, timeoutSec)
  resolve the node's templates against the current scope
  port, output = execute(node)            # retried per node.retry on failure
  record the visit (port, reason, before/after frames, output)
  next = node.next[port]
  if next is missing → pause and let the operator route, retry or abort
  persist the run
```

- **Back edges are allowed.** Every node has `maxVisits` (default 100) and the document
  has `limits.maxNodeVisits` (default 1000); exceeding either is a node failure.
- **Failures.** A node that throws, cannot capture the screen, or fails a guard is retried
  `retry.times` times. Then its `error` port is taken if connected; otherwise the run pauses
  with `retry`, `abort` and one `route` choice per connected port.
- **Vision cache.** A verdict is cached per frame hash and prompt inside a run, so a loop
  over an unchanged screen does not pay for the same model call twice.
- **Abort safety.** Whenever a run stops early, the runner releases every modifier key and
  mouse button on the target.
- **Trace.** The run record keeps a node-visit trace (capped at 500 entries), per-node
  state for the UI, and the current node id. Secret inputs are never written to the run.
- **Sub-workflows** run in the same runtime with their own variables, a depth limit of 4,
  and return the `outputs` of the `end` node they reach.

## Validation

Saving checks structure (hard errors) and graph quality (issues shown on the canvas):

- errors: unknown node type, invalid config, `start` or an edge pointing at a missing node,
  an edge on a port the node does not have, an unparsable expression or template;
- warnings: nodes unreachable from `start`, required ports left unconnected (the run will
  pause there), `vision_classify`/`switch` with no cases, cycles where no node sets
  `maxVisits` explicitly.

## Agent integration

- `kvmflow_flow_catalog`: node types, ports and config fields.
- `kvmflow_flow_patch`: batched `add_node`, `update_node`, `remove_node`, `connect`,
  `disconnect`, `set_start`, `set_meta` operations; returns issues and YAML.
- `kvmflow_flow_validate`, `kvmflow_node_test` (run one node against the live target).
- `kvmflow_workflow_*` keep working; `kvmflow_workflow_generate` emits a linear v2 graph.
- `kvmflow_run_start` accepts `inputs`; `kvmflow_run_control` accepts `route` and `choose`.

## Compatibility

A v1 document (`version: 1` or a `steps` list) converts to a chain:
`steps[i]` becomes an action node with the same `precondition` and `verify`;
`onFailure: retry` becomes `retry.times`; `continue` routes `error` to the next node;
`abort` routes `error` to a failure `end`; `pause` leaves `error` unconnected.
The first load writes the original to `workflows/.backup/<id>.v1.yaml` and saves v2.

## Canvas

React Flow (MIT) is bundled into the client with esbuild; React, React DOM and the JSX
runtime come from the DSH module table, so React is not duplicated. Layout: node palette,
canvas (pan, zoom, connect, minimap, auto layout), inspector generated from the catalog,
issue list, and a YAML tab that round-trips through the Host parser. During a run, the
current node pulses and visited nodes and taken edges are highlighted.
