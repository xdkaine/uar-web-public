import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ExternalRequestPage from '@/app/request/external/page';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(<StrictMode><ExternalRequestPage /></StrictMode>);
