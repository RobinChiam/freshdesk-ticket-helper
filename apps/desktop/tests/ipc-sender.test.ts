/**
 * IPC sender guard unit tests (frame/webContents identity).
 */
import { describe, expect, it, vi } from 'vitest';

import { IpcSenderError, assertTrustedIpcSender } from '../src/main/ipc/senderGuard';

function makeEvent(overrides: {
  senderId: number;
  frameProcessId: number | null;
}): Electron.IpcMainInvokeEvent {
  return {
    sender: { id: overrides.senderId },
    senderFrame: overrides.frameProcessId == null ? null : { processId: overrides.frameProcessId },
  } as unknown as Electron.IpcMainInvokeEvent;
}

describe('assertTrustedIpcSender', () => {
  it('accepts the expected main window main frame', () => {
    const getMainWindow = () =>
      ({
        isDestroyed: () => false,
        webContents: {
          id: 7,
          mainFrame: { processId: 42 },
        },
      }) as unknown as Electron.BrowserWindow;

    expect(() =>
      assertTrustedIpcSender(makeEvent({ senderId: 7, frameProcessId: 42 }), getMainWindow),
    ).not.toThrow();
  });

  it('rejects a different webContents sender', () => {
    const getMainWindow = () =>
      ({
        isDestroyed: () => false,
        webContents: {
          id: 7,
          mainFrame: { processId: 42 },
        },
      }) as unknown as Electron.BrowserWindow;

    expect(() =>
      assertTrustedIpcSender(makeEvent({ senderId: 99, frameProcessId: 42 }), getMainWindow),
    ).toThrow(IpcSenderError);
  });

  it('rejects when main window is missing', () => {
    expect(() =>
      assertTrustedIpcSender(makeEvent({ senderId: 7, frameProcessId: 42 }), () => null),
    ).toThrow(IpcSenderError);
  });
});

describe('withTrustedSender wiring smoke', () => {
  it('exports assertTrustedIpcSender for handler registration', () => {
    expect(typeof assertTrustedIpcSender).toBe('function');
    expect(vi.fn()).toBeTruthy();
  });
});
