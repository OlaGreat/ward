/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK_ID: string;
  readonly VITE_WARD_CONTRACT: string;
  readonly VITE_LOGGING_LEVEL: string;
  readonly VITE_INDEXER_URI?: string;
  readonly VITE_INDEXER_WS_URI?: string;
}
