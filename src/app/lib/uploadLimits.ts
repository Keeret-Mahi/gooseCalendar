export const MAX_OUTLINE_UPLOADS = 7;
export const MAX_ADMIN_OUTLINE_UPLOADS = 50;
export const MAX_CONCURRENT_OUTLINE_PARSING = 3;
export const MAX_ADMIN_CONCURRENT_OUTLINE_PARSING = 5;
export const MAX_OUTLINE_FILE_SIZE_MB = 1;
export const MAX_ADMIN_OUTLINE_FILE_SIZE_MB = 10;
export const MAX_OUTLINE_FILE_SIZE_BYTES = MAX_OUTLINE_FILE_SIZE_MB * 1024 * 1024;
export const MAX_ADMIN_OUTLINE_FILE_SIZE_BYTES =
  MAX_ADMIN_OUTLINE_FILE_SIZE_MB * 1024 * 1024;
export const MAX_OUTLINE_FILE_SIZE_LABEL = `${MAX_OUTLINE_FILE_SIZE_MB} MB`;
export const MAX_ADMIN_OUTLINE_FILE_SIZE_LABEL = `${MAX_ADMIN_OUTLINE_FILE_SIZE_MB} MB`;

export interface AddOutlineFilesResult {
  acceptedCount: number;
  acceptedFileNames: string[];
  rejectedCount: number;
  message?: string;
}
