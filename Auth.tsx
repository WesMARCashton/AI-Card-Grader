import React, { useEffect, useRef, useState } from 'react';
import { User } from '../types';

interface AuthProps {
  user: User | null;
  onSignIn: () => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
  isAuthReady: boolean;
}

export const Auth: React.FC<AuthProps> = ({ user, onSignIn, onSignOut, isAuthReady }) => {
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getInitials = (name: string): string => {
    if (!name) return '';
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length > 1) return (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
    if (nameParts[0]) return nameParts[0].substring(0, 2).toUpperCase();
    return '';
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignIn = async () => {
    if (!isAuthReady || isSigningIn) return;
    try {
      setIsSigningIn(true);
      await Promise.resolve(onSignIn());
    } catch (e: any) {
      console.error("Firebase sign-in failed:", e);
      alert(e?.message || "Sign-in failed. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await Promise.resolve(onSignOut());
    } catch (e: any) {
      console.error("Sign-out failed:", e);
      alert(e?.message || "Sign-out failed.");
    }
  };

  if (user) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!isDropdownOpen)}
          className="rounded-full overflow-hidden w-10 h-10 border-2 border-transparent hover:border-blue-400 transition bg-white flex items-center justify-center"
          aria-label="Account menu"
        >
          <div className="w-full h-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">
            {getInitials(user.name)}
          </div>
        </button>

        {isDropdownOpen && (
          <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 z-10 ring-1 ring-black ring-opacity-5">
            <div className="px-4 py-3 border-b border-slate-200">
              <p className="text-sm font-semibold text-slate-900">Signed in as</p>
              <p className="text-sm font-medium text-slate-600 truncate">{user.name}</p>
            </div>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); handleSignOut(); }}
              className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Sign Out
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleSignIn}
      disabled={!isAuthReady || isSigningIn}
      className="py-2 px-4 bg-white/70 hover:bg-white text-slate-800 font-semibold rounded-lg shadow-md transition border border-slate-300 disabled:opacity-50"
    >
      {isSigningIn ? 'Signing in…' : 'Sign in with Google'}
    </button>
  );
};
