import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CsvDelimiter,
  ParsedVpnImportRecord,
  VpnImportColumnMapping,
} from "./vpnImportCsv";

interface Props {
  userType: "Internal" | "External";
  portalType?: "Management" | "Limited";
  file: File | null;
  delimiter: CsvDelimiter;
  headers: string[];
  mapping: VpnImportColumnMapping;
  parsedData: ParsedVpnImportRecord[];
  isParsing: boolean;
  isUploading: boolean;
  showPreview: boolean;
  inputRef: (node: HTMLInputElement | null) => void;
  onClose: () => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onDelimiterChange: (value: CsvDelimiter) => void;
  onMappingChange: (mapping: VpnImportColumnMapping) => void;
  onParse: (existing: boolean) => void;
  onImport: () => void;
}

export function VPNImportModalContent({ inputRef, ...props }: Props) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Import {props.userType} VPN Users
            {props.portalType && (
              <Badge variant="outline">{props.portalType} Portal</Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          <ImportInstructions
            userType={props.userType}
            portalType={props.portalType}
          />
          <ImportFileControls {...props} inputRef={inputRef} />
          <ImportPreview {...props} />
        </div>
        <ImportFooter {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ImportInstructions({
  userType,
  portalType,
}: Pick<Props, "userType" | "portalType">) {
  const internal = userType === "Internal";
  return (
    <Card
      className={
        internal
          ? "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900"
          : "bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900"
      }
    >
      <CardContent className="p-4 space-y-3 text-sm">
        <h4 className="font-semibold flex items-center gap-2">
          <Info className="w-4 h-4" />
          {internal ? "Internal Users Import" : "External Users Import"}
        </h4>
        <p>
          {internal
            ? `Importing ${portalType} Portal users from existing VPN infrastructure. These users need Active Directory accounts.`
            : "Importing external VPN users who do not require Active Directory accounts."}
        </p>
        <ul className="list-disc list-inside">
          <li>Required: VPN Username column</li>
          <li>Optional: Full Name, Email, Notes</li>
          <li>Formats: CSV, TSV, or delimited text files</li>
        </ul>
      </CardContent>
    </Card>
  );
}

function ImportFileControls({
  file,
  delimiter,
  isParsing,
  inputRef,
  onFileChange,
  onClear,
  onDelimiterChange,
  onParse,
  showPreview,
}: Props) {
  return (
    <>
      <div className="grid gap-2">
        <Label>Select File</Label>
        <div className="flex gap-3">
          <Input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={onFileChange}
            className="flex-1 cursor-pointer"
          />
          {file && (
            <Button variant="destructive" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
        {file && (
          <p className="text-sm text-muted-foreground">
            Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label>Delimiter</Label>
        <Select
          value={delimiter}
          onValueChange={(value) => onDelimiterChange(value as CsvDelimiter)}
          disabled={!file}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=",">Comma (,)</SelectItem>
            <SelectItem value=";">Semicolon (;)</SelectItem>
            <SelectItem value="\t">Tab</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {file && !showPreview && (
        <Button
          className="w-full"
          onClick={() => onParse(false)}
          disabled={isParsing}
        >
          {isParsing ? "Parsing..." : "Parse File"}
        </Button>
      )}
    </>
  );
}

function ImportPreview({
  showPreview,
  headers,
  mapping,
  parsedData,
  isParsing,
  onParse,
  onMappingChange,
}: Omit<Props, "inputRef">) {
  if (!showPreview) return null;
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="font-semibold">Column Mapping</h4>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onParse(true)}
          disabled={isParsing}
        >
          {isParsing ? "Re-parsing..." : "Re-parse with Current Mapping"}
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ColumnMapping
          label="VPN Username Column"
          required
          value={mapping.vpnUsername}
          headers={headers}
          onChange={(vpnUsername) =>
            onMappingChange({ ...mapping, vpnUsername: vpnUsername ?? 0 })
          }
        />
        <ColumnMapping
          label="Full Name Column"
          value={mapping.fullName}
          headers={headers}
          onChange={(fullName) => onMappingChange({ ...mapping, fullName })}
        />
        <ColumnMapping
          label="Email Column"
          value={mapping.email}
          headers={headers}
          onChange={(email) => onMappingChange({ ...mapping, email })}
        />
        <ColumnMapping
          label="Notes Column"
          value={mapping.notes}
          headers={headers}
          onChange={(notes) => onMappingChange({ ...mapping, notes })}
        />
      </div>
      {parsedData.length === 0 ? (
        <div className="border rounded-lg p-4 text-red-800">
          <h4 className="font-semibold flex gap-2">
            <AlertTriangle className="w-5 h-5" />
            No Data Parsed
          </h4>
          <p>Adjust the VPN Username mapping and re-parse the file.</p>
        </div>
      ) : (
        <ImportPreviewTable records={parsedData} />
      )}
    </div>
  );
}

function ColumnMapping({
  label,
  required = false,
  value,
  headers,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: number | undefined;
  headers: string[];
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      <Select
        value={value?.toString() ?? "none"}
        onValueChange={(next) =>
          onChange(next === "none" ? undefined : Number(next))
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value="none">None</SelectItem>}
          {headers.map((header, index) => (
            <SelectItem
              key={`${header}:${headers.slice(0, index).filter((item) => item === header).length}`}
              value={index.toString()}
            >
              {header}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function ImportPreviewTable({ records }: { records: ParsedVpnImportRecord[] }) {
  return (
    <div className="space-y-3">
      <h4 className="font-semibold">Preview ({records.length} records)</h4>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th>VPN Username</th>
              <th>Full Name</th>
              <th>Email</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {records.slice(0, 10).map((record) => (
              <tr key={record.sourceRow}>
                <td>{record.vpnUsername}</td>
                <td>{record.fullName || "-"}</td>
                <td>{record.email || "-"}</td>
                <td>{record.notes || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function ImportFooter({
  parsedData,
  showPreview,
  isUploading,
  onClose,
  onImport,
}: Pick<
  Props,
  "parsedData" | "showPreview" | "isUploading" | "onClose" | "onImport"
>) {
  return (
    <div className="flex justify-between items-center pt-4 border-t mt-4">
      <span className="text-sm text-muted-foreground">
        {parsedData.length > 0 &&
          `${parsedData.length} records ready to import`}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {showPreview && (
          <Button
            onClick={onImport}
            disabled={isUploading || parsedData.length === 0}
          >
            {isUploading ? "Importing..." : "Import Records"}
          </Button>
        )}
      </div>
    </div>
  );
}
