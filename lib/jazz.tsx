"use client";

import { JazzProvider as BaseJazzProvider, useAccount as baseUseAccount, useCoState, useAcceptInvite, PassphraseAuthBasicUI } from "jazz-react";
import type { ResolveQuery, ResolveQueryStrict, Loaded } from "jazz-tools";
import { wordlist } from "@scure/bip39/wordlists/english";
import { TodoAccount, TodoAccountClass } from "./schema";

// Get API key from environment or use email for development
const JAZZ_PEER = (process.env.NEXT_PUBLIC_JAZZ_PEER || "wss://cloud.jazz.tools/?key=todo@tionis.dev") as `wss://${string}`;

// Export hooks typed for our account schema
export { useCoState, useAcceptInvite };

// Typed useAccount hook for TodoAccount
export function useAccount(): { me: Loaded<typeof TodoAccount, true>; logOut: () => void };
export function useAccount<R extends ResolveQuery<typeof TodoAccount>>(options: { resolve?: ResolveQueryStrict<typeof TodoAccount, R> }): { me: Loaded<typeof TodoAccount, R> | undefined | null; logOut: () => void };
export function useAccount<R extends ResolveQuery<typeof TodoAccount>>(options?: { resolve?: ResolveQueryStrict<typeof TodoAccount, R> }) {
  return baseUseAccount(TodoAccount, options);
}

interface JazzProviderProps {
  children: React.ReactNode;
}

export function JazzProvider({ children }: JazzProviderProps) {
  return (
    <BaseJazzProvider
      sync={{
        peer: JAZZ_PEER,
        when: "signedUp",
      }}
      AccountSchema={TodoAccountClass}
    >
      <PassphraseAuthBasicUI appName="Smart Todos" wordlist={wordlist}>
        {children}
      </PassphraseAuthBasicUI>
    </BaseJazzProvider>
  );
}
