/** Yield to a real browser task without nested setTimeout's 4 ms clamp.
 * A channel belongs to one pending yield and both ports close before resuming
 * the caller. No worker/document/job retains an idle port or callback queue.
 * This schedules work; it imposes no execution deadline or search budget.
 */
export function createTaskYield({MessageChannel: Channel = globalThis.MessageChannel,
    setTimeout: timer = globalThis.setTimeout.bind(globalThis)} = {}) {
    return () => new Promise(resolve => {
        if (typeof Channel !== 'function') { timer(resolve, 0); return; }
        let channel, finished = false;
        const close = () => {
            if (!channel) return;
            for (const port of [channel.port1, channel.port2]) {
                try { port.onmessage = null; port.onmessageerror = null; port.close(); } catch { /* Best-effort cleanup also covers a failed channel implementation. */ }
            }
        };
        const finish = () => {
            if (finished) return;
            finished = true; close(); resolve();
        };
        const fallback = () => {
            if (finished) return;
            finished = true; close(); timer(resolve, 0);
        };
        try {
            channel = new Channel();
            channel.port1.onmessage = finish;
            channel.port1.onmessageerror = fallback;
            channel.port2.postMessage(null);
        } catch { fallback(); }
    });
}

export const yieldTask = createTaskYield();
