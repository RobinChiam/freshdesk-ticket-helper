/**
 * Central IPC sender/frame validation.
 * Payload schemas alone are not enough — requests must originate from the expected
 * application BrowserWindow main frame.
 */
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

export class IpcSenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcSenderError';
  }
}

/**
 * Reject IPC invokes that do not come from our main window's main frame.
 * Does not trust renderer-supplied paths, URLs, ticket identities, or credential state.
 */
export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new IpcSenderError('IPC sender rejected: main window unavailable.');
  }

  if (event.sender.id !== mainWindow.webContents.id) {
    throw new IpcSenderError('IPC sender rejected: unexpected webContents.');
  }

  const mainFrame = mainWindow.webContents.mainFrame;
  const senderFrame = event.senderFrame;
  if (!senderFrame || !mainFrame || senderFrame.processId !== mainFrame.processId) {
    throw new IpcSenderError('IPC sender rejected: unexpected frame.');
  }
}

/** Wrap an IPC handler so sender validation always runs before privileged work. */
export function withTrustedSender<Args extends unknown[], Result>(
  getMainWindow: () => BrowserWindow | null,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>,
): (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> {
  return async (event, ...args) => {
    assertTrustedIpcSender(event, getMainWindow);
    return handler(event, ...args);
  };
}
