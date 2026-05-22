'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { fetchWithCsrf } from '@/lib/csrf';
import DatePicker from '@/components/DatePicker';
import { useAdminPageTracking } from '@/hooks/useAdminPageTracking';

interface AccountRow {
  name: string;
  email: string;
  institution: string;
  eventReason: string;
  error?: string;
  status?: 'pending' | 'success' | 'error';
}

export default function BatchAccountsPage() {
  const router = useRouter();
  useAdminPageTracking('Batch Accounts Upload', 'batch');

  useEffect(() => {
    document.title = 'Batch Account Creation | User Access Request (UAR) Portal';
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [csvData, setCsvData] = useState<AccountRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{
    successful: number;
    failed: number;
    total: number;
    details: AccountRow[];
  } | null>(null);
  const [expirationDate, setExpirationDate] = useState('');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());

        // Parse CSV
        const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
        const nameIndex = headers.indexOf('name');
        const emailIndex = headers.indexOf('email');
        const institutionIndex = headers.indexOf('institution');
        const eventIndex = headers.findIndex(h => h === 'event' || h === 'eventreason');

        if (nameIndex === -1 || emailIndex === -1) {
          setError('CSV must have "name" and "email" columns');
          return;
        }

        const accounts: AccountRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values.length < 2) continue;

          accounts.push({
            name: values[nameIndex] || '',
            email: values[emailIndex] || '',
            institution: institutionIndex >= 0 ? values[institutionIndex] || '' : '',
            eventReason: eventIndex >= 0 ? values[eventIndex] || '' : '',
            status: 'pending',
          });
        }

        // Validate accounts
        accounts.forEach(account => {
          if (!account.name) {
            account.error = 'Name is required';
            account.status = 'error';
          } else if (!account.email) {
            account.error = 'Email is required';
            account.status = 'error';
          } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email)) {
            account.error = 'Invalid email format';
            account.status = 'error';
          } else if (!account.institution) {
            account.error = 'Institution is required';
            account.status = 'error';
          }
        });

        setCsvData(accounts);
        setError('');
      } catch (err) {
        setError('Failed to parse CSV file. Please check the format.');
      }
    };

    reader.readAsText(file);
  };

  const handleProcess = async () => {
    if (!expirationDate) {
      setError('Please select an expiration date for the accounts');
      return;
    }

    const validAccounts = csvData.filter(a => a.status !== 'error');
    if (validAccounts.length === 0) {
      setError('No valid accounts to process');
      return;
    }

    setProcessing(true);
    setError('');

    try {
      const response = await fetchWithCsrf('/api/admin/batch-accounts/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accounts: validAccounts,
          accountExpiresAt: new Date(expirationDate).toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process batch accounts');
      }

      setResults(data);
      setCsvData([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setProcessing(false);
    }
  };

  const downloadTemplate = () => {
    const template = 'Name,Email,Institution,Event\nJohn Doe,john@example.com,UCLA,Cyber Competition 2025\nJane Smith,jane@example.com,USC,Cyber Competition 2025';
    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch-accounts-template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const downloadResults = () => {
    if (!results) return;

    const csv = 'Name,Email,Institution,Event,Status,Error\n' +
      results.details.map(a =>
        `${a.name},${a.email},${a.institution},${a.eventReason},${a.status},${a.error || ''}`
      ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-results-${Date.now()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-100 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <button
            onClick={() => router.push('/admin')}
            className="text-gray-700 hover:text-black hover:underline flex items-center gap-2 font-medium mb-6"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Admin Dashboard
          </button>

          <h1 className="text-4xl font-bold text-gray-900 mb-2">Batch Account Creation</h1>
          <p className="text-gray-600">
            Create multiple external user accounts simultaneously for events or workshops
          </p>
        </motion.div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {results && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-6 bg-white rounded-lg shadow-md"
          >
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Processing Complete</h2>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <p className="text-sm text-green-600 font-medium">Successful</p>
                <p className="text-3xl font-bold text-green-900">{results.successful}</p>
              </div>
              <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                <p className="text-sm text-red-600 font-medium">Failed</p>
                <p className="text-3xl font-bold text-red-900">{results.failed}</p>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-600 font-medium">Total</p>
                <p className="text-3xl font-bold text-blue-900">{results.total}</p>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={downloadResults}
                className="bg-black text-white py-2 px-4 rounded-md hover:bg-gray-800 transition-colors"
              >
                Download Results CSV
              </button>
              <button
                onClick={() => setResults(null)}
                className="bg-gray-200 text-gray-900 py-2 px-4 rounded-md hover:bg-gray-300 transition-colors"
              >
                Process Another Batch
              </button>
            </div>
          </motion.div>
        )}

        {!results && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-white rounded-lg shadow-md p-8"
          >
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Upload CSV File</h2>
              <p className="text-sm text-gray-600 mb-4">
                Upload a CSV file with columns: Name, Email, Institution, Event
              </p>
              <button
                onClick={downloadTemplate}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium mb-4"
              >
                Download CSV Template
              </button>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none p-2"
              />
            </div>

            {csvData.length > 0 && (
              <>
                <div className="mb-6">
                  <DatePicker
                    label="Account Expiration Date"
                    value={expirationDate}
                    onChange={setExpirationDate}
                    minDate={new Date()}
                    required
                    placeholder="Select expiration date for all accounts"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    All accounts in this batch will expire on this date
                  </p>
                </div>

                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Preview ({csvData.length} accounts)
                  </h3>
                  <div className="border border-gray-200 rounded-lg overflow-auto max-h-96">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Institution</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {csvData.map((account, index) => (
                          <tr key={index} className={account.status === 'error' ? 'bg-red-50' : ''}>
                            <td className="px-4 py-3 text-sm text-gray-900">{account.name}</td>
                            <td className="px-4 py-3 text-sm text-gray-900">{account.email}</td>
                            <td className="px-4 py-3 text-sm text-gray-900">{account.institution}</td>
                            <td className="px-4 py-3 text-sm text-gray-900">{account.eventReason}</td>
                            <td className="px-4 py-3 text-sm">
                              {account.status === 'error' ? (
                                <span className="text-red-600">{account.error}</span>
                              ) : (
                                <span className="text-green-600">Valid</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    onClick={handleProcess}
                    disabled={processing || csvData.filter(a => a.status !== 'error').length === 0}
                    className="flex-1 bg-black text-white py-3 px-6 rounded-md hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    {processing ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing {csvData.filter(a => a.status !== 'error').length} accounts...
                      </span>
                    ) : (
                      `Process ${csvData.filter(a => a.status !== 'error').length} Valid Accounts`
                    )}
                  </button>
                  <button
                    onClick={() => setCsvData([])}
                    disabled={processing}
                    className="px-6 py-3 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">Important Notes</h3>
          <ul className="list-disc list-inside space-y-2 text-sm text-blue-800">
            <li>All accounts will be created as external users</li>
            <li>Usernames will be auto-generated based on email addresses</li>
            <li>Account credentials will be emailed to each user</li>
            <li>All accounts in the batch will have the same expiration date</li>
            <li>Processing may take several minutes for large batches</li>
            <li>Failed accounts can be retried individually from the admin dashboard</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
