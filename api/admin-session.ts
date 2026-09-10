import { handleAdminSessionRequest } from "../src/server/adminSession.js";

export default async function handler(request: any, response: any) {
  await handleAdminSessionRequest(request, response);
}
