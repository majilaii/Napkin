/* eslint-disable import/first */
import React from 'react';
// @ts-expect-error react-test-renderer has no declarations
import TestRenderer, { act } from 'react-test-renderer';
const mockOpen = jest.fn();
const mockRemove = jest.fn();
let mockListener: (url: string) => void;
let mockInitial: (url: string | null) => void;
jest.mock('@/lib/localNotify', () => ({
    configureNotifications: jest.fn(),
    addNotificationResponseListener: (fn: (url: string) => void) => { mockListener = fn; return mockRemove; },
    getInitialNotificationUrl: () => new Promise((resolve) => { mockInitial = resolve; }),
}));
import { useNotificationNavigation } from './useNotificationNavigation';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
function Gate({ ready }: { ready: boolean }) { useNotificationNavigation(ready, mockOpen); return null; }
it('holds a cold tap through loading, sign-in and onboarding, opens once when ready', async () => {
    let tree: any;
    await act(async () => { tree = TestRenderer.create(<Gate ready={false} />); });
    await act(async () => mockInitial('/import-progress?openJob=local&outcome=review'));
    await act(async () => tree.update(<Gate ready={false} />));
    expect(mockOpen).not.toHaveBeenCalled();
    await act(async () => tree.update(<Gate ready />));
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith('/import-progress?openJob=local&outcome=review');
    await act(async () => tree.update(<Gate ready />));
    expect(mockOpen).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
    expect(mockRemove).toHaveBeenCalledTimes(1);
});
it('opens a live Gather response without changing its destination', async () => {
    let tree: any;
    await act(async () => { tree = TestRenderer.create(<Gate ready />); });
    await act(async () => mockListener('/gathering/123'));
    expect(mockOpen).toHaveBeenCalledWith('/gathering/123');
    await act(async () => tree.unmount());
});

it('a delayed initial response cannot overwrite a newer live tap', async () => {
    let tree: any;
    await act(async () => { tree = TestRenderer.create(<Gate ready={false} />); });
    await act(async () => mockListener('/import-progress?openJob=new'));
    await act(async () => mockInitial('/import-progress?openJob=old'));
    await act(async () => tree.update(<Gate ready />));
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith('/import-progress?openJob=new');
    await act(async () => tree.unmount());
});
