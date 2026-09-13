import { validateUrl } from '@/lib/urlValidation';

type SourceLike = { type?: string | null; url?: string | null } | null | undefined;

/** Only remote original sources can be reopened; uploaded files stay local. */
export function importSourceLink(source: SourceLike): { url: string; label: string } | null {
    if (!source?.url || !['tiktok', 'web', 'google_maps'].includes(source.type ?? '')) return null;
    const url = source.url.trim();
    const checked = validateUrl(url);
    if (!checked.ok || checked.url.username || checked.url.password) return null;
    const host = checked.url.hostname.toLowerCase();
    const isHost = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (source.type === 'tiktok') {
        return isHost('tiktok.com') ? { url, label: 'open TikTok' } : null;
    }
    if (isHost('instagram.com')) return { url, label: 'open Instagram' };
    return { url, label: source.type === 'google_maps' ? 'open Google Maps' : 'open source' };
}
