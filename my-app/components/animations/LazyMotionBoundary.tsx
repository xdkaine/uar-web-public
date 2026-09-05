'use client';

import { LazyMotion, domAnimation } from 'framer-motion';
import type { ReactNode } from 'react';

export function LazyMotionBoundary({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
