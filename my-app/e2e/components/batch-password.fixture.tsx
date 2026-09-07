import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BatchAccountField as Field } from "@/components/admin/BatchAccountField";
import { downloadBatchAccountWorkbookTemplate, readBatchAccountWorkbook } from "@/lib/batch-account-workbook";

function Fixture() {
  const [value, setValue] = useState("generated-password");
  const [result, setResult] = useState("");
  const read = async (file: File) => {
    try {
      const data = await readBatchAccountWorkbook(file);
      setResult(`${data.adAccounts.length} AD / ${data.vpnAccounts.length} VPN / ${data.adAccounts[0]?.ldapUsername} / ${data.adAccounts[0]?.password}`);
    } catch (error) { setResult(error instanceof Error ? error.message : "Import failed"); }
  };
  return <main>
    <Field id="batch-password" label="Initial password" value={value} onChange={setValue} password onGenerate={() => setValue("new-generated-password")} />
    <button onClick={() => void downloadBatchAccountWorkbookTemplate()}>Download template</button>
    <label htmlFor="workbook">Import workbook</label><input id="workbook" type="file" onChange={event => { const file = event.target.files?.[0]; if (file) void read(file); }} />
    <output data-testid="import-result">{result}</output>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
