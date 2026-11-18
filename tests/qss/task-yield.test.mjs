import assert from 'node:assert/strict';
import test from 'node:test';
import {createTaskYield, yieldTask} from '../../lib/qss/src/task-yield.mjs';

test('task yield resumes after a channel task and closes both ports before resolving', async () => {
    let channel, timers = 0, closed = 0, settled = false;
    class Channel {
        constructor() {
            channel = this;
            this.port1 = {close() { closed++; }};
            this.port2 = {close() { closed++; }, postMessage(value) { assert.equal(value, null); }};
        }
    }
    const task = createTaskYield({MessageChannel: Channel, setTimeout() { timers++; }});
    const pending = task().then(() => { settled = true; assert.equal(closed, 2); });
    await Promise.resolve(); assert.equal(settled, false); assert.equal(closed, 0);
    channel.port1.onmessage({data: null});
    await pending; assert.equal(settled, true); assert.equal(timers, 0);
    assert.equal(channel.port1.onmessage, null); assert.equal(channel.port1.onmessageerror, null);
});

test('missing failed and message-error channels use an asynchronous timer fallback without leaked ports', async () => {
    for (const mode of ['missing', 'constructor', 'post', 'message']) {
        let callback, closed = 0, channel;
        class Channel {
            constructor() {
                if (mode === 'constructor') throw new Error('unavailable');
                channel = this;
                this.port1 = {close() { closed++; }};
                this.port2 = {close() { closed++; }, postMessage() { if (mode === 'post') throw new Error('unavailable'); }};
            }
        }
        const task = createTaskYield({MessageChannel: mode === 'missing' ? null : Channel,
            setTimeout(fn, delay) { assert.equal(delay, 0); callback = fn; }});
        let settled = false; const pending = task().then(() => { settled = true; });
        if (mode === 'message') channel.port1.onmessageerror({});
        await Promise.resolve(); assert.equal(settled, false);
        assert.equal(closed, ['post', 'message'].includes(mode) ? 2 : 0);
        assert.equal(typeof callback, 'function'); callback(); await pending;
        assert.equal(settled, true);
    }
});

test('concurrent yields use independent task channels and release every port once', async () => {
    const channels = []; let closed = 0;
    class Channel {
        constructor() {
            channels.push(this); this.port1 = {close() { closed++; }};
            this.port2 = {close() { closed++; }, postMessage() {}};
        }
    }
    const task = createTaskYield({MessageChannel: Channel});
    const a = task(), b = task(), stale = channels[0].port1.onmessage;
    channels[1].port1.onmessage({}); await b; assert.equal(closed, 2);
    channels[0].port1.onmessage({}); await a; assert.equal(closed, 4);
    stale({}); assert.equal(closed, 4);
});

test('real browser task yields preserve external cancellation and support repeated calls', async () => {
    const signal = new AbortController();
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { signal.abort(); channel.port1.close(); channel.port2.close(); };
    channel.port2.postMessage(null);
    // Keep yielding until the separately queued external task is dispatched.
    // A synchronous/microtask-only replacement would starve that task.
    while (!signal.signal.aborted) await yieldTask();
    for (let i = 0; i < 10; i++) await yieldTask();
    assert.equal(signal.signal.aborted, true);
});

test('a real browser worker remains responsive to parent cancellation between yields', {skip: typeof Worker === 'undefined'}, async () => {
    const source = `const createTaskYield=${createTaskYield.toString()};const task=createTaskYield();let cancelled=false;
        self.onmessage=async event=>{if(event.data==='cancel'){cancelled=true;return;}
            self.postMessage('ready');let yields=0;while(!cancelled){await task();yields++;}
            self.postMessage({cancelled,yields});self.close();};`;
    const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'})), worker = new Worker(url);
    try {
        const result = await new Promise((resolve, reject) => {
            worker.onerror = event => reject(new Error(event.message));
            worker.onmessage = event => { if (event.data === 'ready') worker.postMessage('cancel'); else resolve(event.data); };
            worker.postMessage('start');
        });
        assert.equal(result.cancelled, true); assert.ok(result.yields > 0);
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
});
