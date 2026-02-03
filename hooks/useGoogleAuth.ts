
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
  expiresAt: number; // Expiration timestamp in milliseconds
}

export const useGoogleAuth = () => {
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
        try {
            return JSON.parse(savedUser);
        } catch (e) {
            console.error("Failed to parse user from localStorage", e);
            localStorage.removeItem('user');
            return null;
        }
    }
    return null;
  });
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false); 
  const inFlightTokenRequest = useRef<Promise<string> | null>(null);
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

        if (!clientId) {
             console.error("Google Client ID not found.");
             setIsAuthReady(true);
             return;
        }

        if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.initialize({
                client_id: clientId,
                callback: handleCredentialResponse,
                auto_select: true
            });

            const client = google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/spreadsheets',
              callback: (tokenResponse: any) => {
                // Global callback for the client, will be handled by individual request promises
                if (tokenClient?.onTokenResponse) {
                  tokenClient.onTokenResponse(tokenResponse);
                }
              },
            });
            setTokenClient(client);
            setIsAuthReady(true); 
        }
    }
    
    if (typeof google !== 'undefined') {
        initializeGsi();
    } else {
      const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (script) {
        script.addEventListener('load', initializeGsi);
        return () => script.removeEventListener('load', initializeGsi);
      }
    }
  }, []);

  const getAccessToken = useCallback((silent: boolean = false): Promise<string> => {
    if (cachedTokenRef.current && Date.now() < cachedTokenRef.current.expiresAt - (5 * 60 * 1000)) {
      return Promise.resolve(cachedTokenRef.current.token);
    }
    
    if (inFlightTokenRequest.current) {
      return inFlightTokenRequest.current;
    }

    const authPromise = new Promise<string>((resolve, reject) => {
      if (!tokenClient) {
        inFlightTokenRequest.current = null;
        return reject(new Error('Authentication client not ready.'));
      }
      
      const timeoutDuration = silent ? 5000 : 60000;
      const timeoutId = setTimeout(() => {
          tokenClient.onTokenResponse = null;
          inFlightTokenRequest.current = null;
          reject(new Error(silent ? 'Silent authentication failed.' : 'Authentication timed out. Please try again.'));
      }, timeoutDuration);

      tokenClient.onTokenResponse = (tokenResponse: any) => {
        clearTimeout(timeoutId);
        tokenClient.onTokenResponse = null;
        inFlightTokenRequest.current = null;
        
        if (tokenResponse && tokenResponse.access_token) {
          const expiresInMs = (tokenResponse.expires_in || 3600) * 1000;
          cachedTokenRef.current = {
            token: tokenResponse.access_token,
            expiresAt: Date.now() + expiresInMs,
          };
          resolve(tokenResponse.access_token);
        } else {
          const error = tokenResponse?.error_description || tokenResponse?.error || 'Failed to retrieve access token.';
          // If silent fails, we don't want to spam the console with scary errors
          if (!silent) console.error("OAuth2 Error:", tokenResponse);
          reject(new Error(error));
        }
      };

      const config: any = { 
        prompt: silent ? '' : 'select_account',
      };
      
      // Use hint if we have the user's email to make the process smoother
      if (user?.email) {
        config.hint = user.email;
      }

      try {
        tokenClient.requestAccessToken(config);
      } catch (err) {
        clearTimeout(timeoutId);
        tokenClient.onTokenResponse = null;
        inFlightTokenRequest.current = null;
        reject(err);
      }
    });

    inFlightTokenRequest.current = authPromise;
    return inFlightTokenRequest.current;
  }, [tokenClient, user]);


  return { user, signOut, getAccessToken, isAuthReady };
};
