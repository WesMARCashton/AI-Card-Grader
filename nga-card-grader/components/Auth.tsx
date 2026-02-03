import React, { useEffect, useRef, useState } from 'react';
import { User } from '../types';

interface AuthProps {
  user: User | null;
  onSignOut: () => void;
  isAuthReady: boolean;
}

export const Auth: React.FC<AuthProps> = ({ user, onSignOut, isAuthReady }) => {
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const signInButtonRef = useRef<HTMLDivElement>(null);

  const getInitials = (name: string): string => {
    if (!name) return '';
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length > 1) {
        return (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase();
    }
    if (nameParts[0]) {
        return nameParts[0].substring(0, 2).toUpperCase();
    }
    return '';
  };

  const renderGoogleButton = () => {
    if (google && signInButtonRef.current) {
        setTimeout(() => {
            if (signInButtonRef.current) {
                signInButtonRef.current.innerHTML = ''; 
                google.accounts.id.renderButton(
                    signInButtonRef.current,
                    { theme: 'outline', size: 'large', type: 'standard', text: 'signin_with' }
                );
            }
        }, 0);
    }
  };
  
  useEffect(() => {
    // Only attempt to render the button if the user is not signed in
    // AND the Google Sign-In client library is fully initialized.
    if (!user && isAuthReady) {
        if (google) {
            renderGoogleButton();
        } else {
            // This is a fallback for a very rare race condition where the script is not yet on the global scope.
            const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
            if (script) {
                script.addEventListener('load', renderGoogleButton);
                return () => script.removeEventListener('load', renderGoogleButton);
            }
        }
    }
  }, [user, isAuthReady]);
  
  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (user) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button onClick={() => setDropdownOpen(!isDropdownOpen)} className="rounded-full overflow-hidden w-10 h-10 border-2 border-transparent hover:border-blue-400 transition bg-white flex items-center justify-center">
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
            <a href="#" onClick={(e) => { e.preventDefault(); onSignOut(); }} className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">
              Sign Out
            </a>
          </div>
        )}
      </div>
    );
  }

  // The div for the Google button. It will be rendered into by the Google script.
  return <div ref={signInButtonRef}></div>;
};