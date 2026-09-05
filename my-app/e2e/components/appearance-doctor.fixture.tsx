import { createRoot } from 'react-dom/client';

import AppearancePanel from '@/components/admin/config/AppearancePanel';
import {
  DEFAULT_NAV_LINKS,
  DEFAULT_REQUEST_EXTERNAL_CONTENT,
  DEFAULT_REQUEST_INTERNAL_CONTENT,
  PAGE_APPEARANCE_IDS,
  PAGE_APPEARANCE_REGISTRY,
} from '@/lib/appearance';
import '@/app/globals.css';

const customPages = Object.fromEntries(PAGE_APPEARANCE_IDS.map((id) => [
  PAGE_APPEARANCE_REGISTRY[id].key,
  JSON.stringify({ ...PAGE_APPEARANCE_REGISTRY[id].defaultContent, title: `Fixture ${id}` }),
]));

(window as Window & { appearanceFixtureData?: Record<string, unknown> }).appearanceFixtureData = {
  'appearance.theme': JSON.stringify({ logoUrl: '/fixture.svg', brandAccent: '#EAB308', radius: 'standard' }),
  'nav.links': JSON.stringify([...DEFAULT_NAV_LINKS, { label: 'Fixture', href: '/fixture', section: 'main' }]),
  'pages.requestInternal': JSON.stringify({ ...DEFAULT_REQUEST_INTERNAL_CONTENT, title: 'Fixture internal' }),
  'pages.requestExternal': JSON.stringify({ ...DEFAULT_REQUEST_EXTERNAL_CONTENT, title: 'Fixture external' }),
  ...customPages,
};

createRoot(document.getElementById('root')!).render(<AppearancePanel />);
