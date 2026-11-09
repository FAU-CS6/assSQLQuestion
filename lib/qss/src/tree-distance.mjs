const label = n => n.kind + ':' + n.value;
const weight = n => n.kind === 'Script' || n.kind === 'CompositeIdentifier' ? 0
    : n.kind === 'Keyword' || n.kind === 'Operator' ? 2 : 1;

export function prepareTree(root) {
    let serial = 0;
    const walk = n => {
        n.id = serial++;
        n.size = weight(n);
        n.key = n.kind.length + ':' + n.kind + n.value.length + ':' + n.value + '['
            + n.children.map(c => { walk(c); n.size += c.size; return c.key.length + ':' + c.key; }).join('') + ']';
    };
    walk(root); return root;
}

/**
 * Exact DP for the specified ordered subtree edit graph. Edges relabel a node,
 * insert a whole child subtree, or delete a whole child subtree. Children cannot
 * be promoted/reparented. This is deliberately NOT unrestricted tree edit QSS.
 */
export async function subtreeDistance(answer, reference, context, cutoff = Infinity) {
    const memo = new Map();
    const cap = x => Math.min(cutoff, x);
    const distance = async (a, b) => {
        if (a.key === b.key) return {distance: 0, same: true};
        const key = a.id + '/' + b.id;
        if (memo.has(key)) return memo.get(key);
        await context.tick();
        const ac = a.children, bc = b.children, width = bc.length + 1;
        const trace = new Uint8Array((ac.length + 1) * width);
        let row = new Float64Array(width);
        for (let j = 1; j < width; ++j) { row[j] = cap(row[j - 1] + bc[j - 1].size); trace[j] = 2; }
        for (let i = 1; i <= ac.length; ++i) {
            const next = new Float64Array(width);
            next[0] = cap(row[0] + ac[i - 1].size); trace[i * width] = 1;
            for (let j = 1; j < width; ++j) {
                const pair = await distance(ac[i - 1], bc[j - 1]);
                const replace = cap(row[j - 1] + pair.distance);
                const remove = cap(row[j] + ac[i - 1].size), insert = cap(next[j - 1] + bc[j - 1].size);
                next[j] = Math.min(replace, remove, insert);
                trace[i * width + j] = next[j] === replace ? 0 : next[j] === remove ? 1 : 2;
            }
            row = next;
        }
        const own = label(a) === label(b) ? 0 : Math.max(weight(a), weight(b));
        const result = {distance: cap(own + row[bc.length]), trace, own};
        memo.set(key, result); return result;
    };
    const final = await distance(answer, reference), edits = [];
    const describe = n => ({kind: n.kind, value: n.value, nodes: n.size});
    const reconstruct = async (a, b, path) => {
        const result = await distance(a, b);
        if (result.same) return;
        if (result.own) edits.push({type: 'replace', path, before: describe(a), after: describe(b), cost: result.own});
        const steps = [], width = b.children.length + 1;
        let i = a.children.length, j = b.children.length;
        while (i || j) {
            const op = result.trace[i * width + j];
            if (!i || op === 2) { steps.push({op: 2, b: b.children[--j], path: path + '/' + j}); }
            else if (!j || op === 1) { steps.push({op: 1, a: a.children[--i], path: path + '/' + i}); }
            else { --i; --j; steps.push({op: 0, a: a.children[i], b: b.children[j], path: path + '/' + i}); }
        }
        for (const step of steps.reverse()) {
            if (step.op === 0) await reconstruct(step.a, step.b, step.path);
            else edits.push({type: step.op === 1 ? 'delete' : 'insert', path: step.path,
                ...(step.a ? {before: describe(step.a)} : {after: describe(step.b)}), cost: (step.a || step.b).size});
        }
    };
    if (final.distance < cutoff) await reconstruct(answer, reference, '');
    return {distance: final.distance, edits, visited: context.visited, capped: final.distance >= cutoff};
}
