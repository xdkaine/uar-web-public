'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from "next/link";

const Footer: React.FC = () => {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: "easeOut", delay: 0.6 }}
      className="bg-black text-white p-8 text-center shadow-lg"
    >
      <div className="container mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="mb-6"
        >
          <div className="w-24 h-12 relative mx-auto mb-4">
            <Image src="/logo3og.png" alt="SOC Logo" fill className="object-contain" />
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.0 }}
          className="flex justify-center space-x-8 mb-4"
        >
          <Link href="https://calpolysoc.org/contact" className="text-white hover:text-blue-400 transition duration-300 font-medium border-b border-transparent hover:border-blue-400 pb-1 flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
            </svg>
            <span>Contact Us</span>
          </Link>
          <a href="https://wiki.cppsoc.xyz" className="text-white hover:text-blue-400 transition duration-300 font-medium border-b border-transparent hover:border-blue-400 pb-1 flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
            </svg>
            <span>Wiki</span>
          </a>
          <Link href="https://calpolysoc.org/faq" className="text-white hover:text-blue-400 transition duration-300 font-medium border-b border-transparent hover:border-blue-400 pb-1 flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>FAQ</span>
          </Link>
          <a href="https://github.com/cpp-soc" className="text-white hover:text-blue-400 transition duration-300 font-medium border-b border-transparent hover:border-blue-400 pb-1 flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path>
            </svg>
            <span>GitHub</span>
          </a>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.2 }}
          className="text-sm text-gray-400 flex items-center justify-center gap-2"
        >
          <span>Made by</span>
          <a href="https://www.linkedin.com/in/thomasphao" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">Tommy</a>
          <Image src="/love_sticker.gif" unoptimized alt="Love" width={24} height={24} className="object-contain" />
        </motion.div>
      </div>
    </motion.footer>
  );
};

export default Footer;
