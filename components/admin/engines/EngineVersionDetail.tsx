"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { VersionCard } from "./VersionCard";

interface EngineVersionRow {
  version: string;
  notes?: string | null;
  metrics?: any;
}

async function fetchVersions(): Promise<EngineVersionRow[]> {
  const res = await fetch("/api/engines");
  if (!res.ok) throw new Error("Failed to load engine versions");
  return res.json();
}

export function EngineVersionDetail({ version }: { version: string }) {
  const { data, isLoading, error } = useQuery<EngineVersionRow[]>({
    queryKey: ["engine-versions"],
    queryFn: fetchVersions,
  });

  if (!version) {
    return <div className="p-6 text-sm">Loading…</div>;
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading version {version}…</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-red-500">Error loading engine versions.</div>;
  }

  const v = data?.find((row) => row.version === version);

  if (!v) {
    return <div className="p-6 text-sm">Version {version} not found.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Engine {version}</h1>
      <VersionCard version={v.version} notes={v.notes} metrics={v.metrics} />
      <p className="text-xs text-muted-foreground">
        This page can be extended to show best/worst tickers, regression tickers, feature list, and exports.
      </p>
    </div>
  );
}
