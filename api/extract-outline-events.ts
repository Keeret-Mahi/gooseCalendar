import { handleOutlineExtractionRequest } from "../src/server/openaiOutlineExtractor";

export default function handler(request: any, response: any) {
  void handleOutlineExtractionRequest(request, response);
}
