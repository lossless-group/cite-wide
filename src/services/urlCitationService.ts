// cite-wide/src/services/urlCitationService.ts

import { asString, isRecord } from '../utils/coerce';

export interface CitationData {
    title: string;
    author?: string | undefined;
    date?: string | undefined;
    url: string;
    siteName?: string | undefined;
}

export interface UrlCitationResult {
    success: boolean;
    citation?: string;
    hexId?: string;
    error?: string;
    citationData?: CitationData;
}

export class UrlCitationService {
    private jinaReaderUrl = 'https://r.jina.ai/';
    private jinaApiKey: string | null = null;

    constructor() {
        // Reader API works without authentication but API key can avoid rate limits
    }

    /**
     * Extract citation information from a URL using Jina.ai Reader API
     */
    public async extractCitationFromUrl(url: string, existingHexId?: string): Promise<UrlCitationResult> {
        try {
            // Validate URL
            if (!this.isValidUrl(url)) {
                return {
                    success: false,
                    error: 'Invalid URL provided'
                };
            }

            // Extract citation data using Jina.ai Reader API
            const citationData = await this.fetchCitationData(url);

            if (!citationData) {
                return {
                    success: false,
                    error: 'Failed to extract citation data from URL'
                };
            }

            // Use existing hex ID or generate new one
            const hexId = existingHexId || this.generateHexId();
            
            // Format the citation
            const citation = this.formatCitation(citationData, hexId);

            return {
                success: true,
                citation,
                hexId,
                citationData
            };

        } catch (error) {
            console.error('Error extracting citation from URL:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }

    /**
     * Fetch citation data from Jina.ai Reader API
     */
    private async fetchCitationData(url: string): Promise<CitationData | null> {
        try {
            // Use the Jina Reader API to extract structured data from the URL
            const readerUrl = `${this.jinaReaderUrl}${encodeURIComponent(url)}`;
            
            const headers: Record<string, string> = {
                'Accept': 'application/json'
            };
            
            // Add API key to headers if available
            if (this.jinaApiKey) {
                headers['Authorization'] = `Bearer ${this.jinaApiKey}`;
            }
            
            const response = await fetch(readerUrl, {
                method: 'GET',
                headers
            });

            if (!response.ok) {
                throw new Error(`Reader API request failed: ${response.status} ${response.statusText}`);
            }

            const data: unknown = await response.json();
            console.log('Reader API response:', data);

            // Extract citation data from the Reader API response
            const citationData = this.parseReaderResponse(data, url);
            return citationData;

        } catch (error) {
            console.error('Error fetching citation data:', error);
            throw error;
        }
    }

    /**
     * Parse the Reader API response from Jina.ai. The framework returns
     * `unknown` from response.json(); we narrow at the boundary using
     * isRecord + asString (see context-v/reminders/Obsidian-Type-Safety.md §3).
     */
    private parseReaderResponse(data: unknown, originalUrl: string): CitationData | null {
        try {
            // Response may be wrapped as `{ data: {...} }` or flat at the root.
            if (!isRecord(data)) return this.fallbackCitation(originalUrl);
            const root: Record<string, unknown> = isRecord(data['data']) ? data['data'] : data;
            const meta: Record<string, unknown> | null = isRecord(root['metadata']) ? root['metadata'] : null;

            const title = asString(root['title'])
                || (meta && (asString(meta['og:title']) || asString(meta['title'])))
                || 'Unknown Title';

            let date: string | undefined;
            const publishedTime = asString(root['publishedTime'])
                || (meta && (asString(meta['article:published_time']) || asString(meta['og:article:published_time'])))
                || undefined;
            if (publishedTime) {
                const dateObj = new Date(publishedTime);
                if (!Number.isNaN(dateObj.getTime())) {
                    date = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
                } else {
                    console.warn('Could not parse published time:', publishedTime);
                }
            }

            let author: string | undefined;
            if (meta) {
                author = asString(meta['author']) || asString(meta['twitter:data1']);
            }
            if (!author) {
                const content = asString(root['content']);
                if (content) {
                    const m = content.match(/by\s+([^,\n]+)/i)
                        || content.match(/author[:\s]+([^,\n]+)/i)
                        || content.match(/Written by\s+([^,\n]+)/i);
                    if (m && m[1]) author = m[1].trim();
                }
            }

            const siteName = (meta && asString(meta['og:site_name']))
                || this.extractSiteNameFromUrl(originalUrl);

            console.log('Extracted citation data:', { title, author, date, url: originalUrl, siteName });

            return {
                title,
                author: author || undefined,
                date: date || undefined,
                url: originalUrl,
                siteName,
            };
        } catch (error) {
            console.error('Error parsing reader response:', error);
            return this.fallbackCitation(originalUrl);
        }
    }

    private fallbackCitation(originalUrl: string): CitationData {
        return {
            title: 'Unknown Title',
            url: originalUrl,
            siteName: this.extractSiteNameFromUrl(originalUrl),
        };
    }

    /**
     * Format citation data into the required format
     */
    private formatCitation(data: CitationData, hexId: string): string {
        const parts: string[] = [];
        
        // Add date if available
        if (data.date) {
            parts.push(data.date);
        }
        
        // Add title and site name with URL
        const title = data.title || 'Unknown Title';
        const siteName = data.siteName || this.extractSiteNameFromUrl(data.url || '');
        parts.push(`"[${title} | ${siteName}](${data.url || ''})"`);
        
        // Add author if available
        if (data.author) {
            parts.push(data.author);
        }
        
        // Add site name with base URL
        if (data.siteName) {
            const siteUrl = this.getSiteUrl(data.url || '') || data.url || '';
            parts.push(`[${data.siteName}](${siteUrl})`);
        }
        
        return `[^${hexId}]: ${parts.join('. ')}.`;
    }

    /**
     * Generate a unique hex ID for the citation
     */
    private generateHexId(length: number = 6): string {
        return Math.random().toString(16).substring(2, 2 + length);
    }

    /**
     * Validate if the provided string is a valid URL
     */
    private isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Extract site name from URL
     */
    private extractSiteNameFromUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname;
            
            // Remove www. prefix and get the main domain
            const domain = hostname.replace(/^www\./, '');
            
            // Convert domain to title case
            const domainParts = domain.split('.');
            if (domainParts.length === 0) {
                return 'Unknown Site';
            }
            const firstPart = domainParts[0];
            if (!firstPart) {
                return 'Unknown Site';
            }
            return firstPart
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        } catch {
            return 'Unknown Site';
        }
    }

    /**
     * Get the base site URL from a full URL
     */
    private getSiteUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.hostname}`;
        } catch {
            return url;
        }
    }

    /**
     * Set the Jina.ai API key
     */
    public setApiKey(apiKey: string): void {
        this.jinaApiKey = apiKey || null;
    }

    /**
     * Check if the service is properly configured
     */
    public isConfigured(): boolean {
        return true; // Reader API works without authentication
    }

    /**
     * Check if API key is configured
     */
    public hasApiKey(): boolean {
        return !!this.jinaApiKey;
    }
}

// Export a singleton instance
export const urlCitationService = new UrlCitationService(); 