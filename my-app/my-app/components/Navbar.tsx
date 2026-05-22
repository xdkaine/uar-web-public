'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { fetchWithCsrf, invalidateCsrfTokenCache } from '@/lib/csrf';
import { Button } from "@/components/ui/button";
import { User, LogOut, Menu, ChevronDown, Cloud, Server, Network, MessageCircle } from "lucide-react";
// ... existing code ...

const Navbar: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [servicesDropdownOpen, setServicesDropdownOpen] = useState(false);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated);
      setIsAdmin(data.isAdmin);
      setUsername(data.username || '');
      setDisplayName(data.displayName || data.username || '');
    } catch (error) {
      console.error('Failed to fetch session:', error);
      setIsAuthenticated(false);
      setIsAdmin(false);
      setUsername('');
      setDisplayName('');
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchSession();

    // Listen for auth changes
    const handleAuthChange = () => {
      // Delay to ensure backend session is ready
      setTimeout(() => {
        fetchSession();
      }, 100);
    };

    window.addEventListener('authStateChanged', handleAuthChange);

    // Also listen for visibility change to refresh when user returns to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchSession();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('authStateChanged', handleAuthChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchSession]);

  const handleSignOut = async () => {
    try {
      await fetchWithCsrf('/api/auth/logout', { method: 'POST' });
      invalidateCsrfTokenCache();
      setIsAuthenticated(false);
      setIsAdmin(false);
      setUsername('');
      setDisplayName('');
      setUserDropdownOpen(false);
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <motion.nav
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="bg-black p-4 shadow-lg"
    >
      <link rel="icon" href="/favicon.ico" />
      <div className="container mx-auto flex justify-between items-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="text-white text-2xl font-bold"
        >
          <Link href="/">
            <Image
              src="/logo3og.png"
              alt="UAR Portal"
              width={75}
              height={75}
              className="hover:opacity-80 transition-opacity"
            />
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="hidden md:flex space-x-6"
        >
          <Link href="/" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
            </svg>
            <span>Home</span>
          </Link>
          <Link href="/request/internal" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>Internal</span>
          </Link>
          <Link href="/request/external" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>External</span>
          </Link>

          <div className="relative">
            <button
              onClick={() => setServicesDropdownOpen(!servicesDropdownOpen)}
              className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2 w-full md:w-auto"
              aria-expanded={servicesDropdownOpen}
              aria-haspopup="true"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>Services</span>
              <ChevronDown className="w-4 h-4 ml-1" />
            </button>
            {servicesDropdownOpen && (
              <div className="absolute left-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                <a
                  href="https://kamino.sdc.cpp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full text-left px-4 py-2 text-gray-900 hover:bg-gray-100 flex items-center space-x-2 transition duration-200"
                  onClick={() => setServicesDropdownOpen(false)}
                >
                  <span className="font-medium">Kamino</span>
                </a>
                <a
                  href="https://proxmox.sdc.cpp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full text-left px-4 py-2 text-gray-900 hover:bg-gray-100 flex items-center space-x-2 transition duration-200"
                  onClick={() => setServicesDropdownOpen(false)}
                >
                  <span className="font-medium">Proxmox</span>
                </a>
                <a
                  href="https://uma.sdc.cpp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full text-left px-4 py-2 text-gray-900 hover:bg-gray-100 flex items-center space-x-2 transition duration-200"
                  onClick={() => setServicesDropdownOpen(false)}
                >
                  <span className="font-medium">Uma</span>
                </a>
                <a
                  href="https://discord.gg/6smequDTHM"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full text-left px-4 py-2 text-gray-900 hover:bg-gray-100 flex items-center space-x-2 transition duration-200"
                  onClick={() => setServicesDropdownOpen(false)}
                >
                  <span className="font-medium">Discord</span>
                </a>
              </div>
            )}
          </div>
          {isAuthenticated && (
            <Link href="/support/tickets" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span>Support</span>
            </Link>
          )}
          {isAuthenticated && isAdmin && (
            <Link href="/admin" className="text-black bg-yellow-500 hover:bg-yellow-600 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Admin</span>
            </Link>
          )}
          {isAuthenticated ? (
            <div className="relative">
              <Button
                variant="ghost"
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="text-white hover:bg-gray-700 hover:text-white px-4 py-2 h-auto font-medium space-x-2"
              >
                <User className="w-5 h-5" />
                <span>{displayName || username}</span>
                <ChevronDown className="w-4 h-4" />
              </Button>
              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                  <Link
                    href="/profile"
                    className="w-full text-left px-4 py-2 text-gray-900 hover:bg-gray-100 flex items-center space-x-2 transition duration-200"
                    onClick={() => setUserDropdownOpen(false)}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span>Profile</span>
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={handleSignOut}
                    className="w-full justify-start px-4 py-2 h-auto text-gray-900 hover:bg-gray-100 hover:text-gray-900 font-normal"
                  >
                    <LogOut className="w-5 h-5 mr-2" />
                    <span>Sign Out</span>
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <Link href="/login" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
              <span>Sign In</span>
            </Link>
          )}
        </motion.div>

        <div className="md:hidden">
          <Button variant="ghost" size="icon" className="text-white hover:bg-gray-700 hover:text-white" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <Menu className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden bg-black px-4 py-2 rounded-lg mt-2 flex flex-col space-y-2 z-50">
          <Link href="/" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
            </svg>
            <span>Home</span>
          </Link>
          <Link href="/request/internal" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>Internal Student</span>
          </Link>
          <Link href="/request/external" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>External Student</span>
          </Link>

          <div className="border-t border-gray-700 my-2"></div>
          <p className="text-gray-400 px-4 text-xs font-semibold uppercase tracking-wider">Services</p>

          <a href="https://kamino.sdc.cpp" target="_blank" rel="noopener noreferrer" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <Cloud className="w-5 h-5 text-purple-600" />
            <span>Kamino</span>
          </a>
          <a href="https://proxmox.sdc.cpp" target="_blank" rel="noopener noreferrer" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <Server className="w-5 h-5 text-orange-600" />
            <span>Proxmox</span>
          </a>
          <a href="https://uma.sdc.cpp" target="_blank" rel="noopener noreferrer" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <Network className="w-5 h-5 text-indigo-600" />
            <span>Uma</span>
          </a>
          <a href="https://discord.gg/6smequDTHM" target="_blank" rel="noopener noreferrer" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
            <MessageCircle className="w-5 h-5 text-blue-600" />
            <span>Discord</span>
          </a>
          <div className="border-t border-gray-700 my-2"></div>
          {isAuthenticated && (
            <Link href="/support/tickets" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span>My Support Tickets</span>
            </Link>
          )}
          <div className="border-t border-gray-700 my-2"></div>
          {isAuthenticated ? (
            <>
              <div className="text-white px-4 py-2 font-medium flex items-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>Hello, {displayName || username}!</span>
              </div>
              <Link href="/profile" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>Profile</span>
              </Link>
              {isAdmin && (
                <Link href="/admin" className="text-black bg-yellow-500 hover:bg-yellow-600 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Admin</span>
                </Link>
              )}
              <Button
                variant="ghost"
                onClick={handleSignOut}
                className="w-full justify-start text-white hover:bg-gray-700 hover:text-white px-4 py-2 h-auto font-medium"
              >
                <LogOut className="w-5 h-5 mr-2" />
                <span>Sign Out</span>
              </Button>
            </>
          ) : (
            <Link href="/login" className="text-white hover:bg-gray-700 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
              <span>Sign In</span>
            </Link>
          )}
        </div>
      )}
    </motion.nav>
  );
};

export default Navbar;