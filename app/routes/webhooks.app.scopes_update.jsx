import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (session) {
    const current = payload.current;
    const storedSession = await sessionStorage.loadSession(session.id);
    if (storedSession) {
      storedSession.scope = current.toString();
      await sessionStorage.storeSession(storedSession);
    }
  }

  return new Response();
};
