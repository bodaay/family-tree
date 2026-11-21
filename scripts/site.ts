// The family's own site, for the scripts that read it (sync-family, backup-log):
// --api, else the FT_SITE environment variable, else data/family/site.json
// ({ "url": "https://your-family.example" }), kept beside the family's file.
import fs from 'node:fs';

export function siteUrl(): string | undefined {
  if (process.env.FT_SITE) return process.env.FT_SITE;
  try {
    return (JSON.parse(fs.readFileSync('data/family/site.json', 'utf8')) as { url?: string }).url;
  } catch {
    return undefined;
  }
}

export function needSite(api: string | undefined): string {
  if (!api) throw new Error('which site? pass --api https://your-family.example (or set FT_SITE, or write data/family/site.json)');
  return api.replace(/\/+$/, '');
}
