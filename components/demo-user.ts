"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function useDemoUser() {
  const ensureDemo = useMutation(api.users.ensureDemo);
  const [userId, setUserId] = useState<Id<"users"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { ensureDemo().then(setUserId).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to connect to your workspace.")); }, [ensureDemo]);
  return { userId, error };
}