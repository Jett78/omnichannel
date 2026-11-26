"use client";

import { Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { authIconClass, authInputClass } from "@/features/auth/auth-card";
import { cn } from "@/lib/utils";

/** Password field with a leading lock icon and a show/hide toggle. */
export function PasswordInput({
  id,
  name,
  required,
  disabled,
  placeholder,
  autoComplete,
  className,
}: {
  id: string;
  name: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="group relative">
      <Lock className={authIconClass} />
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={cn(authInputClass, "pr-11", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((value) => !value)}
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 transition-colors"
      >
        {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
      </button>
    </div>
  );
}
