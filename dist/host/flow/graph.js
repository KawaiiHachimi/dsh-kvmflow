/**
 * Graph analysis: the issues a canvas shows on a node, and the decorated
 * node/edge view the client renders.
 *
 * Analysis never throws. Errors block saving a document through the agent
 * tools and block starting a run; warnings are shown and allowed.
 */
import { nodeSpec, portsForNode } from './schema.js';
/**
 * Find structural problems in a normalized document.
 * @param document - normalized graph document.
 * @returns issues, errors first.
 */
export function analyzeFlow(document) {
    const issues = [];
    const ids = Object.keys(document.nodes);
    if (document.start === '' || !Object.hasOwn(document.nodes, document.start)) {
        issues.push({ severity: 'error', path: 'start', code: 'start', message: document.start === '' ? 'no start node is set' : `start points at missing node ${JSON.stringify(document.start)}` });
    }
    for (const node of Object.values(document.nodes)) {
        const ports = portsForNode(node.type, node.config);
        const portNames = new Set(ports.map(port => port.name));
        for (const [port, target] of Object.entries(node.next)) {
            if (!portNames.has(port)) {
                issues.push({ severity: 'error', nodeId: node.id, path: `nodes.${node.id}.next.${port}`, code: 'port', message: `${node.type} has no port ${JSON.stringify(port)}` });
            }
            else if (!Object.hasOwn(document.nodes, target)) {
                issues.push({ severity: 'error', nodeId: node.id, path: `nodes.${node.id}.next.${port}`, code: 'target', message: `port ${port} points at missing node ${JSON.stringify(target)}` });
            }
        }
        for (const port of ports) {
            if (port.optional || Object.hasOwn(node.next, port.name))
                continue;
            issues.push({ severity: 'warning', nodeId: node.id, path: `nodes.${node.id}.next.${port.name}`, code: 'unconnected', message: `port ${port.name} is not connected; the run will pause here` });
        }
        if (node.type !== 'end' && ports.length > 0 && ports.every(port => !Object.hasOwn(node.next, port.name))) {
            issues.push({ severity: 'warning', nodeId: node.id, path: `nodes.${node.id}.next`, code: 'dead-end', message: 'no outgoing connection; the run will pause after this node' });
        }
    }
    // Reachability from start.
    const reachable = new Set();
    if (Object.hasOwn(document.nodes, document.start)) {
        const queue = [document.start];
        while (queue.length > 0) {
            const id = queue.shift();
            if (reachable.has(id))
                continue;
            reachable.add(id);
            for (const target of Object.values(document.nodes[id].next)) {
                if (Object.hasOwn(document.nodes, target) && !reachable.has(target))
                    queue.push(target);
            }
        }
        for (const id of ids) {
            if (!reachable.has(id)) {
                issues.push({ severity: 'warning', nodeId: id, path: `nodes.${id}`, code: 'unreachable', message: 'not reachable from start' });
            }
        }
        const reachesEnd = [...reachable].some(id => document.nodes[id].type === 'end');
        if (!reachesEnd && reachable.size > 0) {
            issues.push({ severity: 'warning', path: 'nodes', code: 'no-end', message: 'no end node is reachable; a run that walks off the graph pauses instead of finishing' });
        }
    }
    // Cycles: each strongly connected component with more than one node (or a
    // self loop) must contain a node that bounds it.
    for (const component of stronglyConnected(document)) {
        const looping = component.length > 1 || document.nodes[component[0]].next !== undefined
            && Object.values(document.nodes[component[0]].next).includes(component[0]);
        if (!looping)
            continue;
        const bounded = component.some(id => {
            const node = document.nodes[id];
            return node.type === 'loop' || node.type === 'wait_until' || node.type === 'human' || node.maxVisits !== 100;
        });
        if (!bounded) {
            issues.push({
                severity: 'warning',
                nodeId: component[0],
                path: `nodes.${component[0]}`,
                code: 'cycle',
                message: `cycle through ${component.join(' → ')} has no loop, wait or maxVisits bound; only the default 100-visit limit stops it`,
            });
        }
    }
    return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
function stronglyConnected(document) {
    // Tarjan's algorithm, iterative so a long linear workflow cannot overflow the stack.
    const indexOf = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const result = [];
    let counter = 0;
    const successors = (id) => Object.values(document.nodes[id]?.next ?? {}).filter(target => Object.hasOwn(document.nodes, target));
    for (const root of Object.keys(document.nodes)) {
        if (indexOf.has(root))
            continue;
        const work = [{ id: root, next: 0 }];
        indexOf.set(root, counter);
        low.set(root, counter);
        counter += 1;
        stack.push(root);
        onStack.add(root);
        while (work.length > 0) {
            const frame = work[work.length - 1];
            const children = successors(frame.id);
            if (frame.next < children.length) {
                const child = children[frame.next];
                frame.next += 1;
                if (!indexOf.has(child)) {
                    indexOf.set(child, counter);
                    low.set(child, counter);
                    counter += 1;
                    stack.push(child);
                    onStack.add(child);
                    work.push({ id: child, next: 0 });
                }
                else if (onStack.has(child)) {
                    low.set(frame.id, Math.min(low.get(frame.id), indexOf.get(child)));
                }
                continue;
            }
            work.pop();
            if (work.length > 0) {
                const parent = work[work.length - 1];
                low.set(parent.id, Math.min(low.get(parent.id), low.get(frame.id)));
            }
            if (low.get(frame.id) === indexOf.get(frame.id)) {
                const component = [];
                while (true) {
                    const member = stack.pop();
                    onStack.delete(member);
                    component.push(member);
                    if (member === frame.id)
                        break;
                }
                result.push(component.reverse());
            }
        }
    }
    return result;
}
/** True when any issue blocks running or agent saving. */
export function hasErrors(issues) {
    return issues.some(issue => issue.severity === 'error');
}
/**
 * Lay nodes out left to right by their distance from start, ignoring back
 * edges, and stack siblings vertically in first-seen order. Good enough to make
 * an agent-written graph readable; a human drag overrides it.
 * @param document - graph document.
 * @returns coordinates for every node.
 */
export function autoLayout(document) {
    const COLUMN = 300;
    const ROW = 150;
    const rank = new Map();
    const order = [];
    const ids = Object.keys(document.nodes);
    const roots = Object.hasOwn(document.nodes, document.start) ? [document.start] : [];
    // Any node nothing points at (other than start) also seeds a column, so
    // orphaned nodes do not pile up at the origin.
    const incoming = new Set();
    for (const node of Object.values(document.nodes))
        for (const target of Object.values(node.next))
            incoming.add(target);
    for (const id of ids)
        if (!incoming.has(id) && !roots.includes(id))
            roots.push(id);
    // Longest-path layering over the DAG obtained by dropping back edges found by DFS.
    const state = new Map();
    const back = new Set();
    const visit = (start) => {
        const work = [];
        const enter = (id) => {
            state.set(id, 'open');
            order.push(id);
            work.push({ id, children: Object.values(document.nodes[id].next).filter(target => Object.hasOwn(document.nodes, target)), next: 0 });
        };
        enter(start);
        while (work.length > 0) {
            const frame = work[work.length - 1];
            if (frame.next >= frame.children.length) {
                state.set(frame.id, 'done');
                work.pop();
                continue;
            }
            const child = frame.children[frame.next];
            frame.next += 1;
            const seen = state.get(child);
            if (seen === 'open')
                back.add(`${frame.id}->${child}`);
            else if (seen === undefined)
                enter(child);
        }
    };
    for (const root of roots)
        if (!state.has(root))
            visit(root);
    for (const id of ids)
        if (!state.has(id))
            visit(id);
    for (const id of order)
        rank.set(id, 0);
    // Relax in DFS order a bounded number of times; the DAG makes this converge.
    for (let pass = 0; pass < ids.length; pass += 1) {
        let changed = false;
        for (const id of order) {
            const node = document.nodes[id];
            for (const target of Object.values(node.next)) {
                if (!Object.hasOwn(document.nodes, target) || back.has(`${id}->${target}`))
                    continue;
                const candidate = rank.get(id) + 1;
                if (candidate > rank.get(target)) {
                    rank.set(target, candidate);
                    changed = true;
                }
            }
        }
        if (!changed)
            break;
    }
    const columns = new Map();
    for (const id of order) {
        const column = rank.get(id);
        const list = columns.get(column) ?? [];
        list.push(id);
        columns.set(column, list);
    }
    const positions = {};
    for (const [column, members] of columns) {
        const offset = -((members.length - 1) * ROW) / 2;
        members.forEach((id, row) => {
            positions[id] = { x: column * COLUMN, y: offset + row * ROW };
        });
    }
    return positions;
}
/**
 * Decorate a document for the canvas.
 * @param document - graph document.
 * @param layout - stored coordinates; missing nodes get auto-layout positions.
 * @returns nodes with ports and positions, and one edge per connected port.
 */
export function toGraph(document, layout) {
    const stored = layout?.nodes ?? {};
    const needsAuto = Object.keys(document.nodes).some(id => stored[id] === undefined);
    const auto = needsAuto ? autoLayout(document) : {};
    const nodes = Object.values(document.nodes).map(node => ({
        id: node.id,
        type: node.type,
        name: node.name,
        ...(node.description === undefined ? {} : { description: node.description }),
        category: nodeSpec(node.type)?.category ?? 'flow',
        config: node.config,
        ports: portsForNode(node.type, node.config),
        next: { ...node.next },
        retry: node.retry,
        maxVisits: node.maxVisits,
        hasPrecondition: node.precondition !== undefined && node.precondition.mode !== 'none',
        ...(node.verify === undefined ? {} : { verify: node.verify }),
        position: stored[node.id] ?? auto[node.id] ?? { x: 0, y: 0 },
    }));
    const edges = [];
    for (const node of nodes) {
        for (const port of node.ports) {
            const target = node.next[port.name];
            if (target === undefined)
                continue;
            edges.push({ id: `${node.id}:${port.name}`, source: node.id, sourcePort: port.name, target, kind: port.kind });
        }
    }
    return {
        version: 2,
        id: document.id,
        name: document.name,
        ...(document.description === undefined ? {} : { description: document.description }),
        ...(document.deviceId === undefined ? {} : { deviceId: document.deviceId }),
        start: document.start,
        inputs: document.inputs,
        vars: document.vars,
        limits: document.limits,
        ...(document.bios === undefined ? {} : { bios: document.bios }),
        nodes,
        edges,
        layout: { version: layout?.version ?? 1, nodes: Object.fromEntries(nodes.map(node => [node.id, node.position])) },
    };
}
