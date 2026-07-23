import { useEffect, useState } from 'react';

/** יוצר object URL מ-Blob ומנקה אותו אוטומטית — לשימוש בכל הצגת תמונה */
export function useObjectUrl(blob: Blob | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return blob ? url : null;
}
