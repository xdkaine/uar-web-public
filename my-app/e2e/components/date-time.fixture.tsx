import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DateTimePicker from '@/components/DateTimePicker';
import '@/app/globals.css';

function Fixture() {
  const [value, setValue] = useState(new URLSearchParams(location.search).get('value') || '2026-09-12T19:00:00.000Z');
  return <main className="mx-auto max-w-md p-4"><DateTimePicker label="Expiration" value={value} onChange={setValue} /><output data-testid="value">{value}</output></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
