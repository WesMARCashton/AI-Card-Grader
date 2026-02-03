
import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from '../types';

declare global {
  const google: any;
}

// Simple JWT decoder
function decodeJwt(token: string): any {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    console.error("Failed to decode JWT", e);
    return null;
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface TokenRequest {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export const useGoogleAuth = () => {
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      try {
        return JSON.parse(savedUser);
      } catch (e) {
        localStorage.removeItem('user');
        return null;
      }
    }
    return null;
  });

  const [tokenClient, setTokenClient] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // Use a ref to store the current pending token request to avoid stale closures in the GIS callback
  const pendingRequestRef = useRef<TokenRequest | null>(null);
  const cachedTokenRef = useRef<CachedToken | null>(null);

  const handleCredentialResponse = (response: any) => {
    const idToken = response.credential;
    const profileObj = decodeJwt(idToken);
    if (profileObj) {
      const userData: User = {
        id: profileObj.sub,
        name: profileObj.name,
        email: profileObj.email,
        picture: profileObj.picture,
      };
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
    }
  };

  const signOut = useCallback(() => {
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
    setUser(null);
    localStorage.removeItem('user');
    cachedTokenRef.current = null;
  }, []);

  useEffect(() => {
    const initializeGsi = () => {
      const clientId = document.querySelector<HTMLMetaElement>('meta[name="google-signin-client_id"]')?.content;
      if (!clientId || typeof google === 'undefined') {
        setIsAuthReady(true);
        return;
      }

      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
        auto_select: true
      });

      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/spreadsheets',
        callback: (tokenResponse: any) => {
          const req = pendingRequestRef.current;
          if (!req) return;

          clearTimeout(req.timeoutId);
          pendingRequestRef.current = null;

          if (tokenResponse && tokenResponse.access_token) {
            const expiresInMs = (tokenResponse.expires_in || 3600) * 1000;
            cachedTokenRef.current = {
              token: tokenResponse.access_token,
              expiresAt: Date.now() + expiresInMs,
            };
            req.resolve(tokenResponse.access_token);
          } else {
            const errorMsg = tokenResponse?.error_description || tokenResponse?.error || 'Failed to retrieve access token.';
            req.reject(new Error(errorMsg));
          }
        },
      });

      setTokenClient(client);
      setIsAuthReady(true);
    };

    if (typeof google !== 'undefined') {
      initializeGsi();
    } else {
      const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (script) {
        script.addEventListener('load', initializeGsi);
      }
    }
  }, []);

  const getAccessToken = useCallback((silent: boolean = false): Promise<string> => {
    // 1. Check Cache
    if (cachedTokenRef.current && Date.now() < cachedTokenRef.current.expiresAt - (5 * 60 * 1000)) {
      return Promise.resolve(cachedTokenRef.current.token);
    }

    // 2. Prevent overlapping requests
    if (pendingRequestRef.current) {
      if (!silent) console.warn("A token request is already in progress.");
      // If the current request is silent and a non-silent one comes in, we might want to override, 
      // but for simplicity we'll just wait for the existing one.
    }

    return new Promise<string>((resolve, reject) => {
      if (!tokenClient) {
        return reject(new Error('Google Authentication client is not initialized yet.'));
      }

      const timeoutDuration = silent ? 8000 : 90000; // Increased non-silent timeout for slower user interactions
      const timeoutId = setTimeout(() => {
        if (pendingRequestRef.current) {
          const err = new Error(silent ? 'Silent authentication failed.' : 'Authentication timed out. Please check if the popup was blocked.');
          pendingRequestRef.current.reject(err);
          pendingRequestRef.current = null;
        }
      }, timeoutDuration);

      pendingRequestRef.current = { resolve, reject, timeoutId };

      try {
        // 'prompt: none' only works if the user is already signed into Google and has authorized the app.
        // It's the standard way to do "silent" token refresh in GIS.
        tokenClient.requestAccessToken({
          prompt: silent ? 'none' : 'select_account',
          hint: user?.email || undefined
        });
      } catch (err) {
        clearTimeout(timeoutId);
        pendingRequestRef.current = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }, [tokenClient, user]);

  return { user, signOut, getAccessToken, isAuthReady };
};
