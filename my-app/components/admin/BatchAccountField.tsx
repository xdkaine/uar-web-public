"use client";

import { useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BatchAccountField({
  id,
  label,
  value,
  onChange,
  type = "text",
  password: isPassword,
  onGenerate,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  password?: boolean;
  onGenerate?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type={isPassword && !visible ? "password" : type}
          autoComplete={isPassword ? "new-password" : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {isPassword && (
          <>
            <Button type="button" variant="outline" size="icon" title="Generate password" aria-label="Generate password" onClick={onGenerate}><RefreshCw className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon" title={visible ? "Hide password" : "Show password"} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
          </>
        )}
      </div>
    </div>
  );
}
