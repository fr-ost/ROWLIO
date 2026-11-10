// Starting the in-page visual selector from the workspace.
import { t } from '@/i18n';
import { request } from '@/messaging/tabClient';
import { focusTargetTab, focusWorkspace, requireTarget, useTarget } from '@/app/stores/target';
import { toast } from '@/app/stores/ui';
import { describeError } from './extract';
import { onContentEvent } from './events';

/** Start picking repeated records. The result arrives as a `picker:done` event. */
export async function startRecordPicker(): Promise<boolean> {
  try {
    const tabId = requireTarget();
    await request(tabId, 'picker:start', { mode: 'records' });
    await focusTargetTab();
    return true;
  } catch (error) {
    useTarget.getState().markError(error);
    toast.error(t('Could not start the visual selector'), describeError(error));
    return false;
  }
}

/**
 * Let the user click a single element on the page and resolve with a selector for it.
 * Resolves null when the user cancels.
 */
export async function pickElement(purpose: string): Promise<{ selector: string; text: string } | null> {
  let tabId: number;
  try {
    tabId = requireTarget();
    await request(tabId, 'picker:start', { mode: 'element', purpose });
  } catch (error) {
    useTarget.getState().markError(error);
    toast.error(t('Could not start the visual selector'), describeError(error));
    return null;
  }
  await focusTargetTab();
  return new Promise((resolve) => {
    const done = (value: { selector: string; text: string } | null) => {
      offElement();
      offCancel();
      void focusWorkspace();
      resolve(value);
    };
    const offElement = onContentEvent('picker:element', (payload) => done({ selector: payload.selector, text: payload.text }));
    const offCancel = onContentEvent('picker:cancelled', (payload) => {
      if (payload.mode === 'element') done(null);
    });
  });
}
