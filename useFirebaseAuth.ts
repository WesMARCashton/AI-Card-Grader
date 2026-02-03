import { useEffect, useState, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  User as FirebaseUser,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { User } from "../types";

// We persist the Google OAuth access token so existing Drive/Sheets code keeps working.
const ACCESS_TOKEN_STORAGE = "nga_google_oauth_access_token";

export const useFirebaseAuth = () => {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem(ACCESS_TOKEN_STORAGE) : null
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const cred = GoogleAuthProvider.credentialFromResult(result);
    const token = (cred as any)?.accessToken as string | undefined;

    if (token) {
      localStorage.setItem(ACCESS_TOKEN_STORAGE, token);
      setAccessToken(token);
    }
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem(ACCESS_TOKEN_STORAGE);
    setAccessToken(null);
    await fbSignOut(auth);
  }, []);

  // This matches your existing app’s expectation: a Google OAuth token for Drive/Sheets APIs.
  const getAccessToken = useCallback(async (_silent: boolean = false) => {
    const token = localStorage.getItem(ACCESS_TOKEN_STORAGE);
    if (!token) throw new Error("Not authenticated (no Google access token). Please sign in again.");
    return token;
  }, []);

  // Still useful later for Firestore/Functions (admin claim checks)
  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) throw new Error("Not authenticated");
    return auth.currentUser.getIdToken(true);
  }, []);

  const user: User | null = fbUser
    ? {
        id: fbUser.uid,
        name: fbUser.displayName || fbUser.email || "User",
        email: fbUser.email || "",
      }
    : null;

  return {
    user,
    signIn,
    signOut,
    getAccessToken, // <-- drop-in replacement for your current useGoogleAuth()
    getIdToken,
    isAuthReady,
    hasAccessToken: !!accessToken,
  };
};
