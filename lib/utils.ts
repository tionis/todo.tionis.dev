import { ID } from "jazz-tools";

export function getListUrl(listId: ID<any>): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/#/list/${encodeURIComponent(listId)}`;
  }
  return `/#/list/${encodeURIComponent(listId)}`;
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  } else {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    } finally {
      document.body.removeChild(textArea);
    }
  }
}
