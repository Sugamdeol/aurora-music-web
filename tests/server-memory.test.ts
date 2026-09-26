// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TaskQueue } from '../server/services/taskQueue';

describe('bounded server work', () => {
  it('runs extraction one at a time and releases the slot even on failure', async () => {
    const queue = new TaskQueue(1, 2);
    let release!: () => void;
    const calls: number[] = [];
    const first = queue.run(async () => { calls.push(1); await new Promise<void>(resolve => { release = resolve; }); throw new Error('Failed'); });
    const failed = expect(first).rejects.toThrow('Failed');
    const second = queue.run(async () => { calls.push(2); return 2; });
    const third = queue.run(async () => { calls.push(3); return 3; });
    expect(calls).toEqual([1]);
    await expect(queue.run(async () => 4)).rejects.toMatchObject({ status: 503 });
    release();
    await failed;
    expect(await second).toBe(2);
    expect(await third).toBe(3);
    expect(calls).toEqual([1, 2, 3]);
    expect(await queue.run(async () => 5)).toBe(5);
  });
});
