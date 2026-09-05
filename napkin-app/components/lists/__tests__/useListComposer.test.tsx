import React from 'react';
// @ts-expect-error react-test-renderer has no types in this project
import TestRenderer, { act } from 'react-test-renderer';
import { useListComposer } from '../useListComposer';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockCreate = jest.fn();
jest.mock('@/hooks/lists/useCreateList', () => ({ useCreateList: () => ({ mutateAsync: mockCreate }) }));
type Options = Parameters<typeof useListComposer>[0];
let composer: ReturnType<typeof useListComposer>;
function Harness(props: Options) { composer = useListComposer(props); return null; }
function setup(overrides: Partial<Options> = {}) {
    const props: Options = { userId: 'viewer', onCreated: jest.fn(), onCancel: jest.fn(), ...overrides };
    let renderer: any;
    act(() => { renderer = TestRenderer.create(<Harness {...props} />); });
    return { props, renderer };
}
beforeEach(() => mockCreate.mockReset());
it('refuses blank and unauthenticated submission', async () => {
    const { renderer } = setup();
    await act(async () => { await composer.submit(); });
    act(() => { composer.change({ title: '  Sunday brunch  ' }); });
    act(() => { renderer.update(<Harness userId={null} onCreated={jest.fn()} onCancel={jest.fn()} />); });
    await act(async () => { await composer.submit(); });
    expect(mockCreate).not.toHaveBeenCalled();
    act(() => renderer.unmount());
});
it('submits the chosen audience, note and seeded place once, freezes draft and cancel while pending', async () => {
    let finish!: (v: { id: string }) => void;
    mockCreate.mockImplementation(() => new Promise((r) => { finish = r; }));
    const { props, renderer } = setup({ initial: { initial_restaurant_id: 'place' } });
    act(() => composer.change({ title: '  Sunday brunch  ', description: '  A short note  ', ranked: true, privacy: 'private', emoji: '☕' }));
    let task!: Promise<void>;
    act(() => { task = composer.submit(); void composer.submit(); composer.cancel(); composer.change({ title: 'changed' }); });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({ title: 'Sunday brunch', description: 'A short note', ranked: true, privacy: 'private', emoji: '☕', initial_restaurant_id: 'place' });
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(composer.draft.title).toBe('  Sunday brunch  ');
    expect(composer.canSubmit).toBe(false);
    await act(async () => { finish({ id: 'new-list' }); await task; });
    expect(props.onCreated).toHaveBeenCalledWith('new-list');
    act(() => renderer.unmount());
});
it('forces Table audience private and permits retry after an error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'new-list' });
    const { props, renderer } = setup({ initial: { table_id: 'table' } });
    act(() => composer.change({ title: 'Table brunch' }));
    await act(async () => { await composer.submit(); });
    expect(composer.error).toBeTruthy();
    expect(composer.canSubmit).toBe(true);
    await act(async () => { await composer.submit(); });
    expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ table_id: 'table', privacy: 'private', description: undefined }));
    expect(composer.error).toBeNull();
    expect(props.onCreated).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
});
it.each(['unmount', 'account change'])('ignores completion after %s', async (change) => {
    let finish!: (v: { id: string }) => void;
    mockCreate.mockImplementation(() => new Promise((r) => { finish = r; }));
    const { props, renderer } = setup();
    act(() => composer.change({ title: 'A list' }));
    let task!: Promise<void>;
    act(() => { task = composer.submit(); });
    act(() => change === 'unmount' ? renderer.unmount() : renderer.update(<Harness {...props} userId="other" />));
    await act(async () => { finish({ id: 'new-list' }); await task; });
    expect(props.onCreated).not.toHaveBeenCalled();
    if (change !== 'unmount') act(() => renderer.unmount());
});
