export const MAX_OUTLINE_UPLOADS = 7;
export const MAX_CONCURRENT_OUTLINE_PARSING = 3;
export const MAX_OUTLINE_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export interface AddOutlineFilesResult {
  acceptedCount: number;
  acceptedFileNames: string[];
  rejectedCount: number;
  message?: string;
}
