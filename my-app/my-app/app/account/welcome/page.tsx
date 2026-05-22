'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';

interface AccessibleSite {
  name: string;
  description: string;
  url?: string;
  icon: 'portal' | 'proxmox' | 'uma' | 'kamino' | 'key';
  color: string;
  badge: string;
  image?: string;
}

export default function WelcomePage() {
  const router = useRouter();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Welcome - Account Activated | User Access Request (UAR) Portal';
  }, []);

  const accessibleSites: AccessibleSite[] = [
    {
      name: 'SOC User Access Portal',
      description: 'The User Access Portal grants you access to all of the tools and resources available to you. This is your starting point for all infrastructure requests.',
      url: 'https://portal.sdc.cpp',
      icon: 'portal',
      color: 'blue',
      badge: 'Access/Support',
      image: '/img/welcome/portal.png'
    },
    {
      name: 'Proxmox VE',
      description: 'Enterprise-grade virtualization management. Access the console of your VMs, manage snapshots, and monitor performance metrics directly. Important: Please ensure you select the "SDC" realm when logging in to authenticate correctly.',
      url: 'https://proxmox.sdc.cpp',
      icon: 'proxmox',
      color: 'orange',
      badge: 'Virtualization',
      image: '/img/welcome/proxmox.png'
    },
    {
      name: 'Uma',
      description: 'Create and manage development resource pools and Virtual Networks (VNets) specific to your Proxmox environment.',
      url: 'https://uma.sdc.cpp',
      icon: 'uma',
      color: 'indigo',
      badge: 'Management',
      image: '/img/welcome/uma.png'
    },
    {
      name: 'Kamino',
      description: 'This application empowers you to rapidly spin up and delete Pods of virtual machines hosted on the Mitchell C. Hill Student Data Center.',
      url: 'https://kamino.sdc.cpp',
      icon: 'kamino',
      color: 'purple',
      badge: 'Automated Deployment',
      image: '/img/welcome/kamino.png'
    }
  ];

  /* Icons can be added back if needed, but for showcase images are preferred */

  return (
    <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden">
      <div className="container mx-auto px-4 sm:px-6 md:px-8 py-12 sm:py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-gray-900 mb-6">
            Your account has been <br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-900 to-gray-600">
              activated
            </span>
          </h1>

          <p className="mt-4 text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            The account you have created with this portal will grant you access to the following resources:
          </p>
        </motion.div>
      </div>

      <div className="relative py-16 sm:py-24">
        {accessibleSites.map((site, index) => (
          <section key={site.name} className="py-16 sm:py-24 overflow-hidden">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className={`flex flex-col lg:flex-row items-center gap-12 lg:gap-24 ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>

                <motion.div
                  className="flex-1 w-full text-center lg:text-left"
                  initial={{ opacity: 0, x: index % 2 === 0 ? -50 : 50 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                >
                  <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-semibold tracking-wide uppercase mb-4 bg-${site.color}-100 text-${site.color}-700`}>
                    {site.badge}
                  </span>

                  <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
                    {site.name}
                  </h2>

                  <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                    {site.description}
                  </p>

                  {site.url && (
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-2 px-8 py-3 rounded-lg text-white font-semibold transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 bg-${site.color}-600 hover:bg-${site.color}-700`}
                    >
                      Access {site.name}
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </a>
                  )}
                </motion.div>

                <motion.div
                  className="flex-1 w-full"
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                >
                  <div
                    className={`relative aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl bg-gray-100 border border-gray-200 group ${site.image ? 'cursor-pointer' : ''}`}
                    onClick={() => site.image && setSelectedImage(site.image)}
                  >
                    {site.image ? (
                      <>
                        <Image
                          src={site.image}
                          alt={`${site.name} Preview`}
                          fill
                          className="object-cover object-top transition-transform duration-500 group-hover:scale-105"
                          sizes="(max-width: 768px) 100vw, 50vw"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 transition-colors duration-300">
                          <div className="opacity-0 group-hover:opacity-100 transform translate-y-4 group-hover:translate-y-0 transition-all duration-300 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg text-sm font-medium text-gray-900 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                            </svg>
                            Click to Expand
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
                        <div className="text-center p-6">
                          <div className={`mx-auto w-16 h-16 mb-4 rounded-full bg-${site.color}-100 flex items-center justify-center text-${site.color}-600`}>
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <p className="text-gray-500 font-medium">{site.name}</p>
                          <p className="text-sm text-gray-400 mt-1">Image coming soon</p>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>

              </div>
            </div>
          </section>
        ))}
      </div>

      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 sm:p-8"
            onClick={() => setSelectedImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-7xl w-full max-h-[90vh] aspect-video rounded-lg overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={selectedImage}
                alt="Enlarged preview"
                fill
                className="object-contain"
                sizes="100vw"
                priority
              />
              <button
                onClick={() => setSelectedImage(null)}
                className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 backdrop-blur-md text-white p-2 rounded-full transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
