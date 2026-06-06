/// <reference types="vite/client" />

import type { NoliaApi } from "../preload";

declare global {
  interface Window {
    nolia: NoliaApi;
  }
}
