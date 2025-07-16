// cite-wide/src/services/urlCitationService.ts
import { Notice } from 'obsidian';

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
    public async extractCitationFromUrl(url: string): Promise<UrlCitationResult> {
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

            // Generate hex ID for the citation
            const hexId = this.generateHexId();
            
            // Format the citation
            const citation = this.formatCitation(citationData, hexId);

            return {
                success: true,
                citation,
                hexId
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

            const data = await response.json();
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
     * Parse the Reader API response from Jina.ai
     */
    private parseReaderResponse(data: any, originalUrl: string): CitationData | null {
        try {
            
            // The Reader API response has the actual data nested under data.data
            const responseData = data.data || data;
            
            // Extract title from multiple possible locations
            const title = responseData.title || 
                         responseData.metadata?.['og:title'] || 
                         responseData.metadata?.title || 
                         'Unknown Title';
            
            // Extract date from published time
            let date: string | undefined;
            const publishedTime = responseData.publishedTime || 
                                responseData.metadata?.['article:published_time'] ||
                                responseData.metadata?.['og:article:published_time'];
            
            if (publishedTime) {
                try {
                    const dateObj = new Date(publishedTime);
                    if (!isNaN(dateObj.getTime())) {
                        date = dateObj.toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'short' 
                        });
                    }
                } catch (e) {
                    console.warn('Could not parse published time:', publishedTime);
                }
            }
            
            // Extract author from metadata or content
            let author: string | undefined;
            if (responseData.metadata?.author) {
                author = responseData.metadata.author;
            } else if (responseData.metadata?.['twitter:data1']) {
                author = responseData.metadata['twitter:data1'];
            } else if (responseData.content) {
                // Try to extract author from content
                const authorMatch = responseData.content.match(/by\s+([^,\n]+)/i) ||
                                  responseData.content.match(/author[:\s]+([^,\n]+)/i) ||
                                  responseData.content.match(/Written by\s+([^,\n]+)/i);
                if (authorMatch) {
                    author = authorMatch[1].trim();
                }
            }
            
            // Extract site name from metadata or URL
            const siteName = responseData.metadata?.['og:site_name'] || 
                           this.extractSiteNameFromUrl(originalUrl || '') || 'Unknown Site';
            
            console.log('Extracted citation data:', {
                title,
                author,
                date,
                url: originalUrl,
                siteName
            });
            
            return {
                title,
                author: author || undefined,
                date: date || undefined,
                url: originalUrl,
                siteName
            };

        } catch (error) {
            console.error('Error parsing reader response:', error);
            
            // Fallback: return basic information
            return {
                title: 'Unknown Title',
                url: originalUrl,
                siteName: this.extractSiteNameFromUrl(originalUrl || '')
            };
        }
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
            return domain.split('.')[0]
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