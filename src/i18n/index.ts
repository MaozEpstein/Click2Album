import { he, type Messages } from './he';

// שפה פעילה — בעתיד תיטען מהגדרות המשתמש ותתמוך ב-en ועוד.
const messages: Messages = he;

export function useT(): Messages {
  return messages;
}

export const t = messages;
