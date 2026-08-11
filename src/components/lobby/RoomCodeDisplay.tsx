"use client";

import { useState } from "react";

const RoomCodeDisplay = ({ code }: { code: string }) => {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // code is already visible on screen, so this is a nice-to-have only.
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="flex flex-col items-center gap-1 rounded-lg border border-black/10 px-6 py-3 transition hover:bg-black/5"
      title="Click to copy"
    >
      <span className="text-xs uppercase tracking-wide text-black/50">Room code</span>
      <span className="font-mono text-3xl font-bold tracking-[0.3em]">{code}</span>
      <span className="text-xs text-black/40">{copied ? "Copied!" : "Click to copy"}</span>
    </button>
  );
};
export default RoomCodeDisplay;
