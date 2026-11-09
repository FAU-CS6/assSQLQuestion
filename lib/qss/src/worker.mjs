import {evaluate} from './engine.mjs';

const jobs = new Map();
self.addEventListener('message', async event => {
    const request = event.data;
    if (!request || typeof request.id !== 'string' && typeof request.id !== 'number') return;
    if (request.type === 'cancel') { jobs.get(request.id)?.abort(); return; }
    if (request.type !== 'evaluate' || jobs.has(request.id)) return;
    const controller = new AbortController();
    jobs.set(request.id, controller);
    try {
        const result = await evaluate(request, progress => self.postMessage({type: 'progress', id: request.id, ...progress}), {signal: controller.signal});
        self.postMessage({type: 'result', id: request.id, result});
    } finally { jobs.delete(request.id); }
});
