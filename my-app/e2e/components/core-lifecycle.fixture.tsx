import { StrictMode, useState } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { usePolling } from '@/hooks/usePolling';
import NotFound from '@/app/not-found';
import ResetPasswordClient from '@/app/reset-password/ResetPasswordClient';
import Navbar from '@/components/Navbar';
import DatePicker from '@/components/DatePicker';
import DateTimePicker from '@/components/DateTimePicker';
import Footer from '@/components/Footer';
import VPNAccountDetailModal from '@/components/admin/VPNAccountDetailModal';
import Toast from '@/components/Toast';
import { TemplateEditor } from '@/components/admin/config/TemplateEditor';
import OperationsDashboardPanel from '@/components/admin/flow/OperationsDashboardPanel';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
import { Combobox } from '@/components/ui/combobox';
import { LazyMotion, domAnimation } from 'framer-motion';
import '@/app/globals.css';

function PollingFixture() {
  const [interval, setInterval] = useState(1000);
  const polling = usePolling(async () => {
    const response = await fetch('/fixture-data');
    const data = await response.text();
    document.documentElement.dataset.resolvedRequests = String(Number(document.documentElement.dataset.resolvedRequests ?? 0) + 1);
    return data;
  }, { interval });
  return <>
    <p>Polling: {String(polling.isPolling)}</p>
    <p>Data: {polling.data}</p>
    <button onClick={polling.stopPolling}>Stop polling</button>
    <button onClick={polling.startPolling}>Start polling</button>
    <button onClick={() => setInterval(10000)}>Slow polling</button>
  </>;
}

const selectionOptions = [{ value: 'research', label: 'Research group', group: 'Groups' }, { value: 'general', label: 'General' }];
function DateTimeFixture() {
  const [value, setValue] = useState('2026-09-04T23:00:00Z');
  return <main className="m-4 max-w-sm">
    <DateTimePicker label="Expires" value={value} onChange={setValue} minDate={new Date('2026-09-04T23:00:00Z')} />
    <p data-testid="datetime-result">{value || 'none'}</p>
  </main>;
}

function ComboboxFixture() {
  const [value, setValue] = useState('research');
  const [reversed, setReversed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  return <form className="m-4 max-w-sm" onSubmit={event => { event.preventDefault(); setSubmitted(true); }}>
    <label htmlFor="group-picker">Group</label>
    <Combobox id="group-picker" options={reversed ? [...selectionOptions].reverse() : selectionOptions} value={value} onValueChange={setValue} clearable />
    <button type="button" onClick={() => setReversed(current => !current)}>Reorder options</button>
    <p data-testid="selection-result">{value || 'none'}</p>
    <p data-testid="form-result">{String(submitted)}</p>
  </form>;
}

function ToastFixture() {
  const [revision, setRevision] = useState(0);
  const [closedRevision, setClosedRevision] = useState<number | null>(null);
  return <>
    <button onClick={() => setRevision(value => value + 1)}>Update unrelated content</button>
    <p data-testid="toast-result">{closedRevision === null ? 'open' : `closed at revision ${closedRevision}`}</p>
    <Toast message="Saved successfully" type="success" isVisible={closedRevision === null} onClose={() => setClosedRevision(revision)} />
  </>;
}

const templateVariables = [{ name: 'user.name', description: 'Recipient name' }, { name: 'request.id', description: 'Request identifier' }];
function TemplateFixture() {
  const [value, setValue] = useState('<p>Welcome</p>');
  return <main className="m-4 max-w-xl"><TemplateEditor value={value} onChange={setValue} variables={templateVariables} /><output data-testid="template-result">{value}</output></main>;
}

function Fixture() {
  const [mounted, setMounted] = useState(true);
  const notFound = new URLSearchParams(location.search).has('notfound');
  const reset = new URLSearchParams(location.search).has('reset');
  const navbar = new URLSearchParams(location.search).has('navbar');
  const datepicker = new URLSearchParams(location.search).has('datepicker');
  const vpnDetail = new URLSearchParams(location.search).has('vpndetail');
  const datetime = new URLSearchParams(location.search).has('datetime');
  const combobox = new URLSearchParams(location.search).has('combobox');
  const toast = new URLSearchParams(location.search).has('toast');
  const footer = new URLSearchParams(location.search).has('footer');
  const [date, setDate] = useState('2026-09-04');
  if (new URLSearchParams(location.search).has('template')) return <TemplateFixture />;
  if (new URLSearchParams(location.search).has('operations')) return <OperationsDashboardPanel />;
  return <>
    <button onClick={() => setMounted(false)}>Unmount fixture</button>
    {mounted && (vpnDetail ? <VPNAccountDetailModal accountId="fixture-vpn" onClose={() => setMounted(false)} /> : datetime ? <DateTimeFixture /> : combobox ? <ComboboxFixture /> : toast ? <ToastFixture /> : footer ? <Footer /> : datepicker ? <main className="p-4"><DatePicker label="Start date" value={date} onChange={setDate} /><p data-testid="selected-date">{date}</p></main> : navbar ? <Navbar /> : reset ? <LazyMotion features={domAnimation}><ResetPasswordClient token="fixture-reset-token" tokenValid={!location.search.includes('invalid')} email="fixture@example.test" initialError="" /></LazyMotion> : notFound ? <NotFound /> : <PollingFixture />)}
  </>;
}

if (new URLSearchParams(location.search).has('localdate-hydration')) {
  const root = document.getElementById('root')!;
  // Matches the separately tested server-rendered empty date snapshot.
  root.innerHTML = '<span data-testid="localdate-result"></span>';
  const renderDate = (value: string) => <span data-testid="localdate-result"><ClientLocalDate value={value} format="date" /></span>;
  const hydrated = hydrateRoot(root, renderDate('2026-09-04T23:00:00Z'), { onRecoverableError(error) { (window as Window & { hydrationErrors?: string[] }).hydrationErrors = [String(error)]; } });
  (window as Window & { updateLocalDate?: (value: string) => void }).updateLocalDate = value => hydrated.render(renderDate(value));
} else {
  createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
}
