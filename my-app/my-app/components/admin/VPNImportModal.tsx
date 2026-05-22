'use client';

import { useState, useRef } from 'react';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, AlertTriangle } from 'lucide-react';

interface VPNImportModalProps {
  userType: 'Internal' | 'External';
  portalType?: 'Management' | 'Limited';
  onClose: () => void;
  onImportComplete: () => void;
}

interface ParsedRecord {
  vpnUsername: string;
  fullName?: string;
  email?: string;
  notes?: string;
  rawData: any;
}

export default function VPNImportModal({ userType, portalType, onClose, onImportComplete }: VPNImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [delimiter, setDelimiter] = useState<',' | ';' | '\t'>(',');
  const [parsedData, setParsedData] = useState<ParsedRecord[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<{
    vpnUsername: number;
    fullName?: number;
    email?: number;
    notes?: number;
  }>({ vpnUsername: 0 });
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setParsing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setParsedData([]);
      setShowPreview(false);
    }
  };

  const parseCSV = async (useExistingMapping = false) => {
    if (!file) {
      showToast('Please select a file', 'error');
      return;
    }

    setParsing(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        showToast('File is empty', 'error');
        setParsing(false);
        return;
      }

      // Parse headers
      const headerLine = lines[0];
      const parsedHeaders = headerLine.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
      setHeaders(parsedHeaders);

      // Use existing mapping or auto-detect
      let mapping = columnMapping;
      if (!useExistingMapping || columnMapping.vpnUsername === undefined) {
        mapping = { vpnUsername: 0 }; // Initialize with required field
        parsedHeaders.forEach((header, index) => {
          const lowerHeader = header.toLowerCase();
          if (lowerHeader.includes('username') || lowerHeader.includes('user') || lowerHeader.includes('member')) {
            mapping.vpnUsername = index;
          } else if (lowerHeader.includes('name') && !lowerHeader.includes('username')) {
            mapping.fullName = index;
          } else if (lowerHeader.includes('email') || lowerHeader.includes('mail')) {
            mapping.email = index;
          } else if (lowerHeader.includes('note') || lowerHeader.includes('comment')) {
            mapping.notes = index;
          }
        });
        setColumnMapping(mapping);
      }
      
      console.log('Parsing with mapping:', mapping, 'Headers:', parsedHeaders);

      // Parse data rows
      const records: ParsedRecord[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));
        
        const record: ParsedRecord = {
          vpnUsername: values[mapping.vpnUsername] || '',
          fullName: mapping.fullName !== undefined ? values[mapping.fullName] : undefined,
          email: mapping.email !== undefined ? values[mapping.email] : undefined,
          notes: mapping.notes !== undefined ? values[mapping.notes] : undefined,
          rawData: Object.fromEntries(parsedHeaders.map((h, i) => [h, values[i]])),
        };

        if (record.vpnUsername) {
          records.push(record);
        }
      }

      console.log('Parsed records:', records.length, 'Sample:', records[0]);
      setParsedData(records);
      setShowPreview(true);
      showToast(`Successfully parsed ${records.length} records`, 'success');
    } catch (error) {
      showToast('Failed to parse file', 'error');
      console.error('Parse error:', error);
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (parsedData.length === 0) {
      showToast('No data to import', 'error');
      return;
    }

    if (columnMapping.vpnUsername === undefined) {
      showToast('VPN Username column must be mapped', 'error');
      return;
    }

    setIsUploading(true);
    try {
      const response = await fetchWithCsrf('/api/admin/vpn-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userType,
          portalType,
          fileName: file?.name,
          records: parsedData,
          columnMapping,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import data');
      }

      const result = await response.json();
      showToast(`Successfully imported ${result.data.totalRecords} records`, 'success');
      onImportComplete();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to import', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Import {userType} VPN Users
            {portalType && <Badge variant="outline">{portalType} Portal</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center justify-center gap-2 text-sm">
            <div className={`flex items-center gap-2 ${file ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center ${file ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`}>1</span>
              Upload File
            </div>
            <div className="w-8 h-0.5 bg-gray-200"></div>
            <div className={`flex items-center gap-2 ${showPreview ? 'text-green-600 font-semibold' : file ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center ${showPreview ? 'bg-green-600 text-white' : file ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>2</span>
              Parse & Map
            </div>
            <div className="w-8 h-0.5 bg-gray-200"></div>
            <div className={`flex items-center gap-2 ${parsedData.length > 0 ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center ${parsedData.length > 0 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>3</span>
              Import
            </div>
          </div>

          <Card className={`${userType === 'Internal' ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
            <CardContent className="p-4 space-y-3 text-sm">
              <h4 className={`font-semibold flex items-center gap-2 ${userType === 'Internal' ? 'text-blue-900' : 'text-orange-900'}`}>
                <Info className="w-4 h-4" />
                {userType === 'Internal' ? 'Internal Users Import' : 'External Users Import'}
              </h4>
              <p className={userType === 'Internal' ? 'text-blue-800' : 'text-orange-800'}>
                {userType === 'Internal' 
                  ? `Importing ${portalType} Portal users from existing VPN infrastructure. These users need Active Directory accounts.`
                  : 'Importing external VPN users who do not require Active Directory accounts.'}
              </p>
              
              <div className={userType === 'Internal' ? 'text-blue-800' : 'text-orange-800'}>
                <div className="font-semibold mb-1">📋 File Requirements:</div>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li><strong>Required:</strong> VPN Username column</li>
                  <li><strong>Optional:</strong> Full Name, Email, Notes</li>
                  <li><strong>Formats:</strong> CSV, TSV, or delimited text files</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-2">
            <Label>Select File</Label>
            <div className="flex gap-3">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFileChange}
                className="flex-1 cursor-pointer"
              />
              {file && (
                <Button
                  variant="destructive"
                  onClick={() => {
                    setFile(null);
                    setParsedData([]);
                    setShowPreview(false);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            {file && (
              <p className="text-sm text-gray-500">
                Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label>Delimiter</Label>
            <Select
              value={delimiter}
              onValueChange={(value) => setDelimiter(value as ',' | ';' | '\t')}
              disabled={!file}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select delimiter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=",">Comma (,)</SelectItem>
                <SelectItem value=";">Semicolon (;)</SelectItem>
                <SelectItem value="\t">Tab</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {file && !showPreview && (
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => parseCSV(false)}
                disabled={isParsing}
              >
                {isParsing ? 'Parsing...' : 'Parse File'}
              </Button>
              <p className="text-sm text-gray-500 text-center">
                Click "Parse File" to preview and map columns before importing
              </p>
            </div>
          )}

          {showPreview && headers.length > 0 && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="font-semibold">Column Mapping</h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => parseCSV(true)}
                  disabled={isParsing}
                >
                  {isParsing ? 'Re-parsing...' : 'Re-parse with Current Mapping'}
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>VPN Username Column <span className="text-red-500">*</span></Label>
                  <Select
                    value={columnMapping.vpnUsername.toString()}
                    onValueChange={(val) => setColumnMapping({ ...columnMapping, vpnUsername: parseInt(val) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((header, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Full Name Column</Label>
                  <Select
                    value={columnMapping.fullName?.toString() || "none"}
                    onValueChange={(val) => setColumnMapping({ ...columnMapping, fullName: val === "none" ? undefined : parseInt(val) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {headers.map((header, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Email Column</Label>
                  <Select
                    value={columnMapping.email?.toString() || "none"}
                    onValueChange={(val) => setColumnMapping({ ...columnMapping, email: val === "none" ? undefined : parseInt(val) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {headers.map((header, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notes Column</Label>
                  <Select
                    value={columnMapping.notes?.toString() || "none"}
                    onValueChange={(val) => setColumnMapping({ ...columnMapping, notes: val === "none" ? undefined : parseInt(val) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {headers.map((header, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {showPreview && parsedData.length === 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h4 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                No Data Parsed
              </h4>
              <p className="text-sm text-red-800 mb-2">
                No records were found with the current column mapping. This usually means the VPN Username column is mapped incorrectly.
              </p>
              <p className="text-sm text-red-800 font-semibold">
                Please adjust the VPN Username column mapping above and click "Re-parse with Current Mapping"
              </p>
            </div>
          )}

          {showPreview && parsedData.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold">Preview ({parsedData.length} records)</h4>
              <div className="border rounded-md overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">VPN Username</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Full Name</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Email</th>
                        <th className="px-4 py-2 text-left font-medium text-muted-foreground">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {parsedData.slice(0, 10).map((record, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono">{record.vpnUsername}</td>
                          <td className="px-4 py-2">{record.fullName || '-'}</td>
                          <td className="px-4 py-2">{record.email || '-'}</td>
                          <td className="px-4 py-2 text-gray-500 truncate max-w-xs">{record.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsedData.length > 10 && (
                  <div className="bg-gray-50 px-4 py-2 text-xs text-center border-t text-muted-foreground">
                    Showing first 10 of {parsedData.length} records
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t mt-4">
          <div className="text-sm text-muted-foreground">
            {parsedData.length > 0 && (
              <span className="font-semibold text-green-600">{parsedData.length} records ready to import</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {showPreview && (
              <Button
                onClick={handleImport}
                disabled={isUploading || parsedData.length === 0}
                className={parsedData.length === 0 ? "opacity-50 cursor-not-allowed" : ""}
              >
                {isUploading ? 'Importing...' : 'Import Records'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
