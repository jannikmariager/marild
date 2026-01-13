"use client";
import { useEffect, useState } from "react";

export type Access = {
  is_logged_in: boolean;
  is_pro: boolean;
  is_trial: boolean;
};

export function useAccess() {
  const [access, setAccess] = useState<Access | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/access/status", { cache: "no-store" });
        const a = (await res.json()) as Access;
        if (!cancelled) setAccess(a);
      } catch {
        if (!cancelled) setAccess({ is_logged_in: false, is_pro: false, is_trial: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return access;
}