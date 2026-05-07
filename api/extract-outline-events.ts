import { handleOutlineExtractionRequest } from "../src/server/openaiOutlineExtractor.js";

export default async function handler(request: any, response: any) {
  await handleOutlineExtractionRequest(request, response);
}
