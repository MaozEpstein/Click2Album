/**
 * הפשטת מקור תמונות — הממשק שכל ספק תמונות מממש:
 * תיקייה מקומית (עכשיו), Google Drive וגלריית טלפון דרך Capacitor (בעתיד).
 */
export interface SourcePhotoFile {
  /** מזהה יציב בתוך המקור (נתיב יחסי / id של Drive) */
  id: string;
  name: string;
  file: File;
}

export interface PhotoSource {
  kind: 'local-folder' | 'google-drive' | 'native-gallery';
  /** מחזיר תמונות אחת-אחת כדי לאפשר עיבוד והצגת התקדמות תוך כדי סריקה */
  listPhotos(): AsyncGenerator<SourcePhotoFile>;
}
