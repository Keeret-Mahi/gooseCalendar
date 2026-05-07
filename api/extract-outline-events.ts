import { handleOutlineExtractionRequest } from "../src/server/openaiOutlineExtractor";

export default async function handler(request: any, response: any) {
  await handleOutlineExtractionRequest(request, response);
}
