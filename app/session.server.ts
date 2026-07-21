import { Session } from "@shopify/shopify-api";
import { getBackendUrl, BACKEND_HEADERS } from "./config/backend.server";

/**
 * SessionStorage interface matching Shopify's requirements.
 */
interface SessionStorage {
  storeSession(session: Session): Promise<boolean>;
  loadSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;
  deleteSessions(ids: string[]): Promise<boolean>;
  findSessionsByShop(shop: string): Promise<Session[]>;
}

/**
 * Reconstructs a Session object from raw backend API response data.
 */
interface SessionData {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope?: string;
  expires?: string;
  accessToken?: string;
  userId?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  accountOwner?: boolean;
  locale?: string;
  collaborator?: boolean;
  emailVerified?: boolean;
}

function buildSession(data: SessionData): Session {
  const session = new Session({
    id: data.id,
    shop: data.shop,
    state: data.state,
    isOnline: data.isOnline,
  });
  session.scope = data.scope;
  session.expires = data.expires ? new Date(data.expires) : undefined;
  session.accessToken = data.accessToken;
  if (data.userId) {
    session.onlineAccessInfo = {
      expires_in: 0,
      associated_user_scope: data.scope || "",
      associated_user: {
        id: data.userId,
        first_name: data.firstName || "",
        last_name: data.lastName || "",
        email: data.email || "",
        account_owner: data.accountOwner || false,
        locale: data.locale || "",
        collaborator: data.collaborator ?? false,
        email_verified: data.emailVerified ?? false,
      },
    };
  }
  return session;
}

/**
 * Custom session storage that delegates all operations to a backend HTTP API.
 */
export class BackendSessionStorage implements SessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    try {
      const response = await fetch(getBackendUrl("/api/sessions"), {
        method: "POST",
        headers: BACKEND_HEADERS,
        body: JSON.stringify({
          id: session.id,
          shop: session.shop,
          state: session.state,
          isOnline: session.isOnline,
          scope: session.scope,
          expires: session.expires,
          accessToken: session.accessToken,
          userId: session.onlineAccessInfo?.associated_user?.id,
          firstName: session.onlineAccessInfo?.associated_user?.first_name,
          lastName: session.onlineAccessInfo?.associated_user?.last_name,
          email: session.onlineAccessInfo?.associated_user?.email,
          accountOwner:
            session.onlineAccessInfo?.associated_user?.account_owner,
          locale: session.onlineAccessInfo?.associated_user?.locale,
          collaborator: session.onlineAccessInfo?.associated_user?.collaborator,
          emailVerified:
            session.onlineAccessInfo?.associated_user?.email_verified,
        }),
      });
      return response.ok;
    } catch (error) {
      console.error("Error storing session:", error);
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      const response = await fetch(getBackendUrl(`/api/sessions/${id}`), {
        method: "GET",
        headers: BACKEND_HEADERS,
      });
      if (!response.ok) return undefined;
      const data = await response.json();
      return buildSession(data);
    } catch (error) {
      console.error("Error loading session:", error);
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      const response = await fetch(getBackendUrl(`/api/sessions/${id}`), {
        method: "DELETE",
        headers: BACKEND_HEADERS,
      });
      return response.ok;
    } catch (error) {
      console.error("Error deleting session:", error);
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      const response = await fetch(getBackendUrl("/api/sessions/bulk-delete"), {
        method: "POST",
        headers: BACKEND_HEADERS,
        body: JSON.stringify({ ids }),
      });
      return response.ok;
    } catch (error) {
      console.error("Error deleting sessions:", error);
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      const response = await fetch(
        getBackendUrl("/api/sessions/by-shop", { shop }),
        {
          method: "GET",
          headers: BACKEND_HEADERS,
        },
      );
      if (!response.ok) return [];
      const sessions: SessionData[] = await response.json();
      return sessions.map(buildSession);
    } catch (error) {
      console.error("Error finding sessions by shop:", error);
      return [];
    }
  }
}
