"use client";

import { useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { fetchWithCsrf } from "@/lib/csrf";
import { VPNImportModalContent } from "./VPNImportModalContent";
import {
  parseVpnImportCsv,
  type CsvDelimiter,
  type ParsedVpnImportRecord,
  type VpnImportColumnMapping,
} from "./vpnImportCsv";

interface VPNImportModalProps {
  userType: "Internal" | "External";
  portalType?: "Management" | "Limited";
  onClose: () => void;
  onImportComplete: () => void;
}

export default function VPNImportModal({
  userType,
  portalType,
  onClose,
  onImportComplete,
}: VPNImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(",");
  const [parsedData, setParsedData] = useState<ParsedVpnImportRecord[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<VpnImportColumnMapping>({
    vpnUsername: 0,
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setParsing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setParsedData([]);
      setShowPreview(false);
    }
  };
  const clearFile = () => {
    setFile(null);
    setParsedData([]);
    setShowPreview(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const parseCSV = async (useExistingMapping = false) => {
    if (!file) {
      showToast("Please select a file", "error");
      return;
    }
    setParsing(true);
    try {
      const parsed = parseVpnImportCsv(
        await file.text(),
        delimiter,
        useExistingMapping ? columnMapping : undefined,
      );
      if (!parsed) {
        showToast("File is empty", "error");
        return;
      }
      setHeaders(parsed.headers);
      setColumnMapping(parsed.mapping);
      setParsedData(parsed.records);
      setShowPreview(true);
      showToast(
        `Successfully parsed ${parsed.records.length} records`,
        "success",
      );
    } catch (error) {
      console.error("Parse error:", error);
      showToast("Failed to parse file", "error");
    } finally {
      setParsing(false);
    }
  };
  const handleImport = async () => {
    if (!parsedData.length) {
      showToast("No data to import", "error");
      return;
    }
    setIsUploading(true);
    try {
      const response = await fetchWithCsrf("/api/admin/vpn-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userType,
          portalType,
          fileName: file?.name,
          records: parsedData.map(({ sourceRow, ...record }) => {
            void sourceRow;
            return record;
          }),
          columnMapping,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Failed to import data");
      showToast(
        `Successfully imported ${result.data.totalRecords} records`,
        "success",
      );
      onImportComplete();
      onClose();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to import",
        "error",
      );
    } finally {
      setIsUploading(false);
    }
  };
  return (
    <VPNImportModalContent
      userType={userType}
      portalType={portalType}
      file={file}
      delimiter={delimiter}
      headers={headers}
      mapping={columnMapping}
      parsedData={parsedData}
      isParsing={isParsing}
      isUploading={isUploading}
      showPreview={showPreview}
      inputRef={(node) => {
        fileInputRef.current = node;
      }}
      onClose={onClose}
      onFileChange={handleFileChange}
      onClear={clearFile}
      onDelimiterChange={setDelimiter}
      onMappingChange={setColumnMapping}
      onParse={(existing) => void parseCSV(existing)}
      onImport={() => void handleImport()}
    />
  );
}
