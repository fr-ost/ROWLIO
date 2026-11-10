// Single source of truth for product identity. Everything user-facing (UI, manifest,
// filenames, docs helpers) reads from brand.config.json through this module.
import raw from '@brand';

export interface BrandConfig {
  name: string;
  storeTitle: string;
  category: string;
  tagline: string;
  company: string;
  attribution: string;
  motto: string;
  shortDescription: string;
  positioning: string;
  promises: string[];
  colors: { brand: string; brandDark: string; ink: string };
  urls: { homepage: string; support: string; privacyPolicy: string; sourceCode: string };
  filePrefix: string;
  projectFileExtension: string;
  recipeFileExtension: string;
}

export const brand: BrandConfig = raw;

declare const __APP_VERSION__: string | undefined;
declare const __E2E__: boolean | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const IS_E2E: boolean = typeof __E2E__ === 'boolean' ? __E2E__ : false;
